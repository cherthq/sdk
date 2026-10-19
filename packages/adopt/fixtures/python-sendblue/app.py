import os
import requests

API = "https://api.sendblue.co/api/send-message"


def send(number, content):
    return requests.post(API, json={"number": number, "content": content}, headers={
        "sb-api-key-id": os.environ["SENDBLUE_API_KEY_ID"],
        "sb-api-secret-key": os.environ["SENDBLUE_API_SECRET_KEY"],
    })
