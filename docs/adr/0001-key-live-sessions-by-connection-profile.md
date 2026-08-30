# Key live sessions by Connection Profile

Picaglass permits at most one live SSH Session per Connection Profile while allowing different profiles to remain connected concurrently. A profile-keyed session manager preserves terminals while the operator switches profiles; deleting a connected profile requires confirmation and disconnects its session, while closing the application warns before disconnecting every session rather than pretending they can survive process exit.
