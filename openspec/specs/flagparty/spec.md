# flagparty Specification

## Purpose

Stateless OBS overlay that hangs a celebration message (a birthday, an anniversary, anything) as bunting across the top of the stream: one letter per flag, up to two strings. Everything comes from the query string of `/flagparty`; there is no storage, login or chat connection.

## Requirements

### Requirement: Message from the URL

The system SHALL render the `message` query parameter at `/flagparty`, one flag per user-perceived character (an emoji is one flag). Spaces SHALL leave a gap instead of a flag. Runs of whitespace SHALL collapse to one space. The message SHALL be capped at 40 characters across both lines. An empty or missing message SHALL render nothing.

#### Scenario: Birthday message

- **WHEN** a browser source loads `/flagparty?theme=birthday&message=Happy+Birthday+Morgan+and+Marie`
- **THEN** each letter hangs on its own flag and the spaces show as gaps

### Requirement: Up to two lines

The first `/` in the message SHALL break it onto a second line; later slashes SHALL show as flags. If either side of the `/` is empty, the message SHALL stay on one line. Without a `/`, a message longer than 14 characters SHALL break at the space that keeps the longer line shortest; a message with no space SHALL stay on one line.

#### Scenario: Streamer picks the break

- **WHEN** the message is `Happy Birthday Morgan/and Marie`
- **THEN** the first string reads `Happy Birthday Morgan` and the second `and Marie`

#### Scenario: Automatic break

- **WHEN** the message is `Happy Birthday Morgan and Marie`
- **THEN** the first string reads `Happy Birthday` and the second `Morgan and Marie`

### Requirement: Curved strings that scale

Each line SHALL hang from a string that curves from the left edge to the right edge of the source. A single string SHALL sag deeper than each of two strings. Flags SHALL be SVG, sized to the longest line and shared by both lines, and the overlay SHALL scale to the browser source's width. Mono and duo flags SHALL tilt with the string; circle flags SHALL hang straight down.

#### Scenario: Two lines are shallower

- **WHEN** the message breaks onto two lines
- **THEN** each string dips less at its middle than a single string would

### Requirement: Flag styles

The `style` parameter SHALL choose the flag shape: `mono` (a single-color pennant, the default), `duo` (a swallowtail flag with a band in a second color), or `circle` (a disc on a short string). An unknown style SHALL fall back to `mono`.

### Requirement: Themes

The `theme` parameter SHALL choose the colors: `birthday` (the default), `anniversary`, `anniversary2` or `pastel`. An unknown theme SHALL fall back to `birthday`. Flag colors SHALL cycle letter by letter through the theme. Letter color SHALL be implicit: light or dark, whichever contrasts more with the flag.
