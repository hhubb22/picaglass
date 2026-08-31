# Picaglass

Picaglass helps an individual operator organize SSH connection settings, open remote terminal sessions, and run read-only PicOS diagnostics on those destinations — interactively and through an embedded Agent Interface.

## Language

**Connection Profile**:
A user-saved SSH destination and its login preferences. Profiles remain distinct when the same destination is used with different usernames or settings.
_Avoid_: Machine, device, host

**Profile Label**:
The name shown for a Connection Profile. It uses a user-chosen display name when present and otherwise derives from the profile's username, destination, and non-default port.
_Avoid_: Machine name, hostname

**SSH Session**:
A live or attempted interactive shell opened from a Connection Profile. Profile status describes this session, not the destination's general availability.
_Avoid_: Connection

**Connection Attempt**:
One effort to open and run an SSH Session. Its durable summary records start, connection, and end times when applicable, plus a final outcome without retaining server diagnostics.
_Avoid_: Session history, audit log

**Terminal Transcript**:
The bounded, in-memory terminal output accumulated for one Connection Profile during the current app run. Local attempt banners separate successive sessions; the transcript is never a persisted session log.
_Avoid_: Session log, connection history

**Authentication Secret**:
A password or private-key passphrase supplied when opening an SSH Session. It is transient and is not part of a Connection Profile.
_Avoid_: Saved credential

**Authentication Method**:
The single login mechanism selected by a Connection Profile: password or a private-key file. Any Authentication Secret required by that method is supplied when a session opens.
_Avoid_: Credential

**Trusted Host Key**:
A server public key accepted for a destination and port. Trust is shared by all Connection Profiles for that endpoint.
_Avoid_: Profile trust

**Machine Snapshot**:
The latest successfully discovered POSIX identity facts for the remote system, recorded with their observation time. It describes what Picaglass observed through a session and may be stale; it does not define Connection Profile identity.
_Avoid_: Machine, device

**Diagnostic Block**:
One of six read-only groups of related PicOS show commands whose outputs together answer one troubleshooting question: device facts, interface status, L2 tables, L3 tables, logs, or tech-support collection.
_Avoid_: Feature, module

**Parsed Result**:
The structured form of one command's text output. It always retains the raw text; when parsing fails it carries the raw text plus a failure marker, never silently dropped.
_Avoid_: JSON, command output

**Agent Interface**:
The MCP server embedded in Picaglass through which an agent invokes the same read-only diagnostic capabilities available to the human operator.
_Avoid_: API, bot
