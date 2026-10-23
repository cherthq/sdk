# Host qualification boundary

Local tested arrangement: separate real Node and Python processes, private Unix
socket, private fsynced journals on a local POSIX filesystem. The owner alone has
provider credentials and owns the original ready session. Node has no provider
management credentials. Its crash/disconnect does not stop application expiry.
No process starts/restarts a customer agent server.

The application now includes reviewable systemd units in `connector/host/`, but
no Linux service manager or deployment volume has been exercised. The owner
restarts on failure, opens persistent journals before touching a stale socket,
checks room ownership and readiness, and never auto-stages. Normal startup fails
if either journal is missing. Explicit --initialize-state is a separate fresh-state
setup, not a recovery command. Uncertain staging persists across restarts and
stops new admission; a restart cannot reset it.

The Node runtime intentionally fails closed on a SIGKILL crash lock. Do not put
`rm *.lock` in a unit. Verify the recorded writer is dead, preserve journal and any
atomic-write temporary evidence, and perform reviewed recovery before restart.
The application owner continues independent expiry/cleanup during that interval.
For graceful stops, locks release and both-process recovery is tested.

Before host qualification can be called complete, the deployment owner must select
and inspect the actual host, prove the persistent path is the intended mounted
volume (including restart/redeploy), pin immutable releases/runtimes, verify private
permissions and environment separation, exercise supervision/crash recovery, and
drain the old receiver's namespace before any new staging. Existing Railway HTTP
healthchecks and process-local continuous slots cannot simply be pointed here.

The host-selection question is outstanding at implementation time. No assumption
that local subprocess tests qualify Railway or systemd is made. No remote access,
volume changes, process restarts, provider sessions or paid staging were performed.
