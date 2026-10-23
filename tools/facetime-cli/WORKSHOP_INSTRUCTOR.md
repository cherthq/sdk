# Instructor checklist: student FaceTime agents

For the October 9, 2026 workshop, distribute the
[student guide](STUDENT_GUIDE.md) and [JavaScript starter](examples/student-agent/).
The baseline is **voice-only, inbound FaceTime Audio**, using **the latest published CLI**
(`npm install -g @trychert/facetime@beta`; the `beta` tag moves to each new release).
Students write their own agent and run it locally. Muse is not a prerequisite.

## Before students arrive

1. **Assign capacity.** Count available, physically tested lines. One Chert project
   must have exactly one line; one line supports one active CLI and one call.
   Assign teams/time slots when students outnumber lines. Do not imply unique
   agent names let several teams use one line simultaneously.
2. **Grant access.** Each student/operator needs owner or admin access to the
   assigned Chert project for the current CLI. Do this only in the intended
   workshop projects; the CLI has no limited student role. Confirm browser login
   using that student's actual account before the session.
3. **Prepare credentials privately.** Supply or help each team create LiveKit
   credentials and a funded model API account. Prefer separate LiveKit projects
   per team. If sharing a project, understand that its API credentials provide
   project access, and assign unique agent names. Never distribute production
   credentials or use the shared Muse agent name for student code.
4. **Provide supported machines.** The starter targets Node 22.23.2 or 24 on macOS
   or Linux. Check Git/npm ahead of time; provide an alternative supported
   environment for Windows students. Provide a FaceTime-capable caller device.
5. **Distribute accessible source.** The CLI is on npm and ships the starters: students run `chert new my-agent` (or `--video`). The starter is also in GitHub,
   not in the CLI tarball. The repository is private. Give students the prepared
   `chert-student-workshop.zip` handout or grant repository access in advance.
   The ZIP includes the guides and `examples/student-agent/`, including
   `.env.example`, `.gitignore` and `package-lock.json`; it must exclude
   `.env.local` and `node_modules`. The student guide documents both paths.
6. **Rehearse the exact student path.** Run `chert new` into a fresh directory,
   `npm ci`, install the latest published CLI, browser-login, folder-based credential loading, then two-terminal
   startup. Make two FaceTime Audio calls per intended line. Record actual
   two-way conversation, interruption, caller hangup, cleanup, a fresh second
   session and clean line release. Do not count doctor or a heartbeat as this test.
7. **Set a spend owner and limit.** Confirm LiveKit/model usage ownership, quotas
   and the support contact. Prewarming and doctor jobs can run student code even
   without a caller. The supplied starter defers model setup until a participant
   arrives; arbitrary student agents may incur charges earlier.

Private assignment card (fill this for each team; never put secret values in the
public guide or this repository):

| Field | Assigned value |
| --- | --- |
| Team / operator | |
| Chert account / project name / UUID | |
| FaceTime address / reserved time slot | |
| Unique agent name | |
| LiveKit project / private credential delivery method | |
| Model provider / private key delivery method / spend owner | |
| Support contact | |
| Two-call rehearsal result / time / tested CLI version | |

## Known readiness boundaries

- See the release receipt for the version you install, in [docs/releases](docs/releases/),
  for registry verification. This is separate from validating every workshop line
  or this starter on a live call.
- On October 8, one Muse video test ended with worker caller-video geometry failure;
  another connected and ended normally but the caller reported missing remote video.
  These observations do not qualify video for the workshop and do not by themselves
  establish whether the voice-only starter works on each intended line.
- Do not add `--muse` to arbitrary student agents. Generic rooms hold two participants;
  avatar/sidecar designs require separate integration work.
- Chert CLI runs on student/operator computers. Native FaceTime worker-only Macs
  do not need the npm package. This workshop documentation does not deploy or
  reconfigure any worker, line, model account or hosted agent.
- Ordinary generic prewarming proves agent membership, not FaceTime readiness.
  Greet the caller within 10 seconds of `bridge_ready`, or the call ends (`remote_audio_timeout`).
  `chert dev` reads each answered call from Chert and, on `bridge_ready`, sets the
  room metadata to `{"chert_call":"<call id>","chert_bridge_ready":true,"at":"<ISO time>"}`
  and prints `FaceTime is ready.` Both starters greet once on it (`greet.mjs`).
  Check every team's agent does the same: it never greets when a job starts or
  when the caller joins, and without the signal the caller speaks first. Teams
  that run their own LiveKit room poll the call API for the worker's
  `bridge_ready` event instead ([developer guide](DEVELOPER_GUIDE.md#7-writing-an-agent-for-facetime)).

## During the workshop

Have students complete the guide in order. When stuck, compare four names first:
Chert project, FaceTime address, LiveKit project, and agent dispatch name. Capture
nonsecret versions, call time, observed behavior and concise error lines.

Keep the instructor responsible for routing changes, stale call recovery,
worker/OBS troubleshooting and coordinated takeovers. Students should not change
Apple accounts, reboot line Macs, delete recovery state, or overwrite each other's
active sessions to resolve an error. A session that is no longer connected (a
closed laptop, a crash, a stop whose release failed) is replaced without
`--takeover`: the next team's `chert dev` takes the line. Use `--takeover` only for
a live holder who agrees, and only with no call in progress. During a call,
`chert dev` refuses with `line_in_call` either way.

## End-of-slot handoff

Have each team start with `chert dev --until HH:MM` (or `--minutes N`) set to the
end of its slot, on a computer whose clock is in the venue's time zone. A minute
before, its terminal warns; at that time it releases the line by itself, after any
call in progress ends, and declines a call that rings after it. `line_in_use` and
`chert doctor` show the next team who holds the line and until when. These flags
exist only from the first release published after this change; check that
`chert dev --help` lists them before the event, or run the handoff by hand with
Ctrl+C.

1. Caller hangs up; wait for `Call ended.`
2. With `--until`, Chert stops by itself; otherwise the student stops it. Wait for
   confirmed line release, then the student stops their agent.
3. Check the next team's doctor result for correct project/line and availability.
4. If cleanup or release failed, hold the handoff and inspect retained state.
5. On shared computers, stop the connector before logout; revoke/dispose of
   workshop credentials according to the agreed account ownership plan.

## Validation record

Leave live outcomes pending until actually observed. Record date, source revision,
Node/CLI versions, intended line, two-way audio, interruption, cleanup and second
session separately. Automated checks and a previous Muse demo are not substitutes
for this starter's physical rehearsal.

October 8 preparation checks completed:

| Check | Result |
| --- | --- |
| Fresh standalone starter install (`npm ci`, pinned lockfile) | Passed on Node 22.23.2 |
| Syntax and SDK imports/help | Passed on Node 22.23.2 and 24.0.0 |
| JavaScript checked against installed SDK types | Passed |
| Offline model-start/caller-binding/shutdown/new-session checks | Passed with mocked SDK services |
| Existing CLI packaged lifecycle test | Passed |
| Local documentation links and `git diff --check` | Passed |
| Student browser login and model account access | Instructor/student must verify |
| Real two-call rehearsal of this starter per workshop line | Pending |

No model request, live call, account grant, line provisioning or worker change was
performed while creating these materials. They are distributed through GitHub;
the original documentation-only update did not republish the CLI. The current
release and registry evidence are recorded separately in the release receipt.
