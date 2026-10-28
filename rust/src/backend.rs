use http::{HeaderMap, Method};
use serde_json::Value;
use std::time::Duration;
use url::Url;

#[cfg(not(feature = "worker"))]
pub(crate) use native::{timeout_ok, Http, Reply};
#[cfg(feature = "worker")]
pub(crate) use workers::{timeout_ok, Http, Reply};

#[cfg(not(any(feature = "reqwest", feature = "worker")))]
compile_error!("enable the `reqwest` (default) or `worker` feature");

#[cfg(all(feature = "reqwest", not(feature = "worker")))]
mod native {
    use super::*;

    pub(crate) fn timeout_ok(timeout: Duration) -> bool {
        std::time::Instant::now().checked_add(timeout).is_some()
    }

    #[derive(Clone)]
    pub(crate) struct Http(reqwest::Client);

    pub(crate) struct Reply(reqwest::Response);

    impl Http {
        pub(crate) fn new(headers: HeaderMap, timeout: Duration) -> Result<Self, ()> {
            reqwest::Client::builder()
                .default_headers(headers)
                .timeout(timeout)
                .redirect(reqwest::redirect::Policy::none())
                .retry(reqwest::retry::never())
                .no_proxy()
                .build()
                .map(Self)
                .map_err(drop)
        }

        pub(crate) async fn send(
            &self,
            method: Method,
            url: Url,
            headers: HeaderMap,
            body: Option<&Value>,
        ) -> Result<Reply, ()> {
            let mut request = self.0.request(method, url).headers(headers);
            if let Some(body) = body {
                request = request.json(body);
            }
            request.send().await.map(Reply).map_err(drop)
        }
    }

    impl Reply {
        pub(crate) fn status(&self) -> u16 {
            self.0.status().as_u16()
        }

        pub(crate) fn header(&self, name: &str) -> Option<String> {
            self.0
                .headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
        }

        pub(crate) fn single_header(&self, name: &str) -> Option<String> {
            let mut values = self.0.headers().get_all(name).iter();
            let first = values.next().and_then(|v| v.to_str().ok())?.to_owned();
            values.next().is_none().then_some(first)
        }

        pub(crate) fn request_id(&self) -> Option<String> {
            self.0
                .headers()
                .get("x-trace-id")
                .or_else(|| self.0.headers().get("x-request-id"))
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
        }

        pub(crate) async fn chunk(
            &mut self,
        ) -> Result<Option<impl std::ops::Deref<Target = [u8]>>, ()> {
            self.0.chunk().await.map_err(drop)
        }
    }
}

#[cfg(feature = "worker")]
mod workers {
    use super::*;
    use futures_util::{
        future::{select, Either},
        StreamExt,
    };
    use std::future::Future;
    use worker::{
        wasm_bindgen::JsValue, AbortController, ByteStream, Date, Delay, Fetch, Headers, Request,
        RequestInit, RequestRedirect, ResponseBody,
    };

    pub(crate) fn timeout_ok(timeout: Duration) -> bool {
        timeout.as_millis() <= i32::MAX as u128
    }

    #[derive(Clone)]
    pub(crate) struct Http {
        headers: HeaderMap,
        timeout: Duration,
    }

    enum Body {
        Stream(ByteStream),
        Buffered(Option<Vec<u8>>),
    }

    pub(crate) struct Reply {
        status: u16,
        headers: Headers,
        body: Body,
        deadline: u64,
        abort: Option<AbortController>,
    }

    impl Drop for Reply {
        fn drop(&mut self) {
            if let Some(abort) = self.abort.take() {
                abort.abort();
            }
        }
    }

    fn remaining(deadline: u64) -> Duration {
        Duration::from_millis(deadline.saturating_sub(Date::now().as_millis()))
    }

    async fn within<F: Future>(deadline: u64, future: F) -> Result<F::Output, ()> {
        let timer = Delay::from(remaining(deadline));
        futures_util::pin_mut!(future);
        match select(future, timer).await {
            Either::Left((output, _)) => Ok(output),
            Either::Right(((), _)) => Err(()),
        }
    }

    impl Http {
        pub(crate) fn new(headers: HeaderMap, timeout: Duration) -> Result<Self, ()> {
            Ok(Self { headers, timeout })
        }

        pub(crate) async fn send(
            &self,
            method: Method,
            url: Url,
            headers: HeaderMap,
            body: Option<&Value>,
        ) -> Result<Reply, ()> {
            let wire = Headers::new();
            for (name, value) in self.headers.iter() {
                if !headers.contains_key(name) {
                    wire.set(name.as_str(), value.to_str().map_err(drop)?)
                        .map_err(drop)?;
                }
            }
            for (name, value) in headers.iter() {
                wire.set(name.as_str(), value.to_str().map_err(drop)?)
                    .map_err(drop)?;
            }
            let mut init = RequestInit::new();
            init.with_method(worker::Method::from(method.as_str().to_owned()))
                .with_redirect(RequestRedirect::Manual);
            if let Some(body) = body {
                if !wire.has("content-type").map_err(drop)? {
                    wire.set("content-type", "application/json").map_err(drop)?;
                }
                let json = serde_json::to_string(body).map_err(drop)?;
                init.with_body(Some(JsValue::from_str(&json)));
            }
            init.with_headers(wire);
            let request = Request::new_with_init(url.as_str(), &init).map_err(drop)?;
            let deadline = Date::now()
                .as_millis()
                .saturating_add(self.timeout.as_millis() as u64);
            let abort = AbortController::default();
            let signal = abort.signal();
            let fetch = Fetch::Request(request);
            let response = match within(deadline, fetch.send_with_signal(&signal)).await {
                Ok(Ok(response)) => response,
                _ => {
                    abort.abort();
                    return Err(());
                }
            };
            let mut response = response;
            let body = if matches!(response.body(), ResponseBody::Stream(_)) {
                Body::Stream(response.stream().map_err(drop)?)
            } else if let ResponseBody::Body(bytes) = response.body() {
                Body::Buffered(Some(bytes.clone()))
            } else {
                Body::Buffered(None)
            };
            Ok(Reply {
                status: response.status_code(),
                headers: response.headers().clone(),
                body,
                deadline,
                abort: Some(abort),
            })
        }
    }

    impl Reply {
        pub(crate) fn status(&self) -> u16 {
            self.status
        }

        pub(crate) fn header(&self, name: &str) -> Option<String> {
            self.headers.get(name).ok().flatten()
        }

        pub(crate) fn single_header(&self, name: &str) -> Option<String> {
            self.header(name)
        }

        pub(crate) fn request_id(&self) -> Option<String> {
            self.header("x-trace-id")
                .or_else(|| self.header("x-request-id"))
        }

        pub(crate) async fn chunk(
            &mut self,
        ) -> Result<Option<impl std::ops::Deref<Target = [u8]>>, ()> {
            match &mut self.body {
                Body::Buffered(bytes) => Ok(bytes.take().filter(|b| !b.is_empty())),
                Body::Stream(stream) => match within(self.deadline, stream.next()).await? {
                    Some(Ok(chunk)) => Ok(Some(chunk)),
                    Some(Err(_)) => Err(()),
                    None => Ok(None),
                },
            }
        }
    }
}
