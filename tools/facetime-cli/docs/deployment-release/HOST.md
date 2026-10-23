# Selected Railway host — inspected, not runtime-qualified

The user selected demo-agent-0 on 2026-09-30. Resolved to the existing
[demo-agent-0-byor project](https://railway.com/project/56930118-77fc-479a-a12f-4c453e7e987c),
production environment `7815a140-42c1-4238-b72d-fb2935923123`, service
`talking-head-webhook` / `679aad53-1b81-4198-a4ae-1bd0cd357b19`.
Read-only dashboard and container-console inspection at approximately 05:02 UTC:

- Active deployment `93fd35f6-42dc-4dd0-bb25-f34deb478092`, dashboard label
  `08c33cf: continuous classic talking head with configurable run mode`.
  The label is not a verified source/archive checksum.
- Online, one replica, US West (California); Dockerfile build; on-failure restart,
  maximum 10 retries. No GitHub repository or image source connected in settings.
- Volume `22f39489-ca8e-4c04-8d42-d6d3e194b379`, 50 GB capacity, mounted at `/state`.
  Actual `/proc/self/mountinfo` confirms a writable ext4 mount at `/state`.
- Python 3.12.14 exists. `node` and `systemctl` are absent from PATH. PID 1 is
  `podman-init`. `/app/connector/server.py` does not exist.
- `/state` permissions are 0755. Proposed application/connector journals need
  dedicated 0700 subdirectories and 0600 files, not journals directly in this root.

**Conclusion:** suitable infrastructure to investigate further, but the deployed
Python-only image cannot run the new Node/Python callback integration as-is.
The systemd examples in this release are Linux reference units, not Railway
installation artifacts. No Railway replacement image is built or qualified here.
A green existing HTTP endpoint does not prove readiness of the new owner.

## Concrete host packaging and qualification work

Prepare a dedicated immutable Railway image from the frozen application and CLI
artifacts. Include pinned Python/locked dependencies and Node 22.23.2; compile
`connector/handler.ts` against the installed package. Run the owner and connector
as separately supervised processes in the same container/private socket namespace.
An ordinary container restart policy alone does not provide the owner independence
needed when only Node fails. Ensure a connector failure cannot kill the owner's
expiry loop or create a restart storm on a retained Node crash lock.

Pass provider credentials only to Python and Chert credentials only to Node;
do not inherit Railway's entire service environment into both children. Use a
non-root runtime user, private socket/admin directory, and distinct state under
`/state/chert-pilot/application-ready-v1` and `/state/chert-pilot/byor-v1`.
Check the expected volume mount before any initialization. Initialize fresh owner
journals exactly once; normal startup must fail closed on missing journals/mount.
Never silently initialize during recovery or delete lock/state evidence.

Keep one replica, disable sleeping and deployment overlap, and set a termination
grace that accommodates the reviewed owner/connector shutdown budgets. Qualify
these effective platform settings, not only a local supervisor configuration.
The health probe must inspect local processes/IPC without staging, allocating,
starting an agent, exposing secrets, or requiring a paid ready slot. The existing
HTTP webhook health path is not that probe.

Before replacing the existing service, explicitly drain its old continuous owner
and verify its resources under its own journal/credentials. Do not import its
in-memory warm slot. Preserve the existing webhook route until the separate
routing decision; no automatic traffic cutover is included in host installation.

On the chosen deployment, using fresh isolated state and provider substitutes,
prove mount persistence across restart/redeploy, private ownership, writer
exclusion, Python crash/reopen, graceful Node restart, fail-closed Node SIGKILL,
independent owner expiry while Node is down, and missing-mount refusal. Record
image digest, runtime versions, volume identity and sanitized outcomes. These
checks require a new image/deployment and controlled restarts; none ran remotely
in this read-only inspection. Physical audio/video is a later separate gate.
