package chert

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
)

// MessagingStreamFrame preserves named frames and their JSON, including error and close.
type MessagingStreamFrame struct {
	Event string
	Data  json.RawMessage
}

// StreamEventsOptions carries an opaque stream continuation, not a list cursor.
type StreamEventsOptions struct{ Since string }

// StreamEvents opens exactly one connection and calls receive synchronously.
// A callback error, close frame, EOF, context cancellation or configured timeout
// ends the call and closes the body. No reconnect or Last-Event-ID is sent.
// EOF is not proof of delivery; an unterminated frame is discarded.
func (c *Client) StreamEvents(ctx context.Context, options StreamEventsOptions, receive func(MessagingStreamFrame) error) error {
	if ctx == nil || receive == nil || !utf8.ValidString(options.Since) {
		return invalid()
	}
	q := url.Values{}
	if options.Since != "" {
		q.Set("since", options.Since)
	}
	target := c.base + "/events/stream?" + q.Encode()
	if len(target) > 16384 {
		return invalid()
	}
	req, err := http.NewRequestWithContext(ctx, "GET", target, nil)
	if err != nil {
		return invalid()
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	req.Header.Set("Accept", "text/event-stream")
	if c.contract != "" {
		req.Header.Set("X-Chert-Contract", c.contract)
	}
	if c.tenant != "" {
		req.Header.Set("X-Chert-Tenant", c.tenant)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return &APIError{Code: "request_failed", cause: cancellationCause(ctx, err)}
	}
	defer res.Body.Close()
	if err := c.checkContract(res); err != nil {
		return err
	}
	media, _, parseErr := mime.ParseMediaType(res.Header.Get("Content-Type"))
	if res.StatusCode < 200 || res.StatusCode >= 300 || parseErr != nil || !strings.EqualFold(media, "text/event-stream") {
		return &APIError{Status: res.StatusCode, Code: "stream_unavailable", RequestID: res.Header.Get("X-Request-ID")}
	}
	var callbackErr error
	err = readMessagingStream(res.Body, func(frame MessagingStreamFrame) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		callbackErr = receive(frame)
		return callbackErr
	})
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if callbackErr != nil {
		return callbackErr
	}
	if err != nil {
		return &APIError{Status: res.StatusCode, Code: "invalid_event_stream", RequestID: res.Header.Get("X-Request-ID"), cause: cancellationCause(ctx, err)}
	}
	return nil
}

func readMessagingStream(body io.Reader, receive func(MessagingStreamFrame) error) error {
	r := bufio.NewReader(body)
	var line, data []byte
	event := ""
	size := 0
	pendingCR, hasData, closed := false, false, false
	consumeLine := func() error {
		if !utf8.Valid(line) {
			return errors.New("invalid stream UTF-8")
		}
		if len(line) == 0 {
			if hasData {
				if _, err := decodeJSON(data); err != nil {
					return err
				}
				if event == "" {
					event = "message"
				}
				if err := receive(MessagingStreamFrame{Event: event, Data: append(json.RawMessage(nil), data...)}); err != nil {
					return err
				}
				if event == "close" {
					closed = true
				}
			}
			size = 0
			event = ""
			data = nil
			hasData = false
		} else if line[0] != ':' {
			field, value, _ := strings.Cut(string(line), ":")
			value = strings.TrimPrefix(value, " ")
			switch field {
			case "event":
				event = value
			case "data":
				if hasData {
					data = append(data, '\n')
				}
				data = append(data, value...)
				hasData = true
			}
		}
		line = line[:0]
		return nil
	}
	for {
		b, err := r.ReadByte()
		if err == io.EOF {
			if pendingCR {
				return consumeLine()
			}
			if !utf8.Valid(line) {
				return errors.New("invalid stream UTF-8")
			}
			return nil
		}
		if err != nil {
			return err
		}
		if pendingCR {
			pendingCR = false
			// Resolve CRLF before dispatch/reset so its final LF belongs to
			// this frame. A non-LF byte belongs to the following line/frame.
			if b == '\n' {
				size++
				if size > 1024*1024 {
					return errors.New("event frame exceeds 1 MiB")
				}
			}
			if err := consumeLine(); err != nil {
				return err
			}
			if closed {
				return nil
			}
			if b == '\n' {
				continue
			}
		}
		size++
		if size > 1024*1024 {
			return errors.New("event frame exceeds 1 MiB")
		}
		switch b {
		case '\r':
			pendingCR = true
		case '\n':
			if err := consumeLine(); err != nil {
				return err
			}
			if closed {
				return nil
			}
		default:
			line = append(line, b)
		}
	}
}
