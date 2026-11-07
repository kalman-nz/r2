# R2

This context manages projects, their schedules, equipment, and crew.

## Language

**Schedule item**:
A named period of work on a project's schedule, such as a usage, billing, or other period.

**Crew need**:
The crew required for one schedule item whose kind is `other`: a crew role, headcount, optional minimum skill level, and the time when that crew is needed. Usage and billing items cannot have crew needs.

**Crew assignment**:
A person assigned to a crew need.

**Active crew assignment**:
A crew assignment that reserves its effective time window and fills a crew slot. Declared unavailability can flag it as conflicting without cancelling the commitment.

**Inactive crew assignment**:
A retained crew assignment that reserves no time and leaves its slot unfilled. It requires a successful activation check before becoming active.

**Crew availability conflict**:
An overlap between active crew work and a person's declared unavailable period or another active crew assignment. Adjacent time windows do not conflict.

**Declared availability**:
A person's own unavailable periods for crew work, shared across the organisations they work with. Time without an unavailable period is available unless a crew assignment blocks it.

**Unavailable period**:
A one-off or weekly recurring interval during which a person cannot take crew work. Overlapping periods combine; an optional public note may accompany a period.

**Availability exception**:
A skipped or replacement occurrence of a recurring unavailable period. It changes that occurrence only, not other unavailable periods or crew assignments.

**Public availability note**:
An optional explanation supplied by a crew member and shared with authorised crew planners in all organisations they currently belong to, including organisations joined after the note was saved.

**Unverified crew availability**:
Availability for a crew person whose identity is not linked to a verified account and therefore cannot be checked across organisations.
