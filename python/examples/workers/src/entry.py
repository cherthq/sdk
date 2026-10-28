import json

from workers import Response, WorkerEntrypoint

from trychert import ChertAPIError, ChertClient, verify_webhook


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        if request.method == "POST":
            body = await request.bytes()
            valid = verify_webhook(body, request.headers.get("x-chert-signature") or "", self.env.CHERT_WEBHOOK_SECRET)
            return Response(json.dumps({"verified": valid}), status=200 if valid else 401,
                            headers={"content-type": "application/json"})
        client = ChertClient(self.env.CHERT_IMESSAGE_URL, self.env.CHERT_IMESSAGE_KEY)
        try:
            result = {"whoami": client.request("/whoami")}
        except ChertAPIError as error:
            result = {"status": error.status, "code": error.code}
        return Response(json.dumps(result), headers={"content-type": "application/json"})
