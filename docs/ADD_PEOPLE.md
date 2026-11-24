# Add People: gated FaceTime contract

These methods target the public participant-operation API. They are source support,
not general service availability: Add People is not enabled in production.
It requires an explicitly eligible active outbound native group and an authorized
project credential. One-to-one, inbound and link-joined calls, email recipients,
Android invitations and participant removal are not supported here.

## TypeScript

```ts
import { ChertControlPlane } from '@trychert/sdk/facetime';

const client = new ChertControlPlane({ token: process.env.CHERT_TOKEN,
  projectId: process.env.CHERT_PROJECT_ID });
// Persist this key with the exact call and recipient before submitting.
const operation = await client.addCallParticipant(callId,
  { recipient: { type: 'phone_number', value: '+12125550102' } }, persistedKey);
const current = await client.getCallParticipant(callId, operation.id);
```

## Python

```python
import os
from trychert import ChertControlPlane

client = ChertControlPlane(token=os.environ['CHERT_TOKEN'],
                          project_id=os.environ['CHERT_PROJECT_ID'])
# Persist this key with the exact call and recipient before submitting.
operation = client.add_call_participant(call_id,
    {'recipient': {'type': 'phone_number', 'value': '+12125550102'}},
    idempotency_key=persisted_key)
current = client.get_call_participant(call_id, operation['id'])
```

`queued` and `dispatching` are pending. `submitted` confirms native submission,
not ringing or joining; `already_present` sends no new invitation. Reads may also
return `failed` or `unknown`. There is no joined-status or cancellation contract.

The SDK never retries these operations automatically. On a transport failure,
retain the original key and identical recipient; do not create a new key. An explicit
identical POST reconciles the existing operation. Failed and uncertain replays raise
`participant_failed` (409) and `participant_outcome_unknown` (502). When the server
supplies a valid operation UUID, errors expose `operationId` (TypeScript) or
`operation_id` (Python), allowing a read without another invitation. No other error
details or server message text are exposed. Never retry an unknown outcome with a
fresh key.

## Artifact verification

`bun run test:package` runs the JavaScript consumer against a clean install of the
packed npm archive. Run `python/tests/test_participants.py` outside the checkout with
the interpreter from a fresh environment containing only the built wheel. Both tests
use real loopback HTTP, not a live call. They check the wire request, all six read
states, replay responses, invalid inputs, receipt binding, sanitized uncertainty
errors and refusal to follow redirects. This does not prove production enablement
or physical invitation success.
