# flagbanner Specification

## Purpose

Stateless OBS overlay (`/sources/flagbanner`, configured at `/widgets/flagbanner`) that hangs a celebration message (a birthday, an anniversary, anything) as bunting across the top of the stream: one letter per flag, up to two strings. Everything comes from the query string of `/sources/flagbanner`; there is no storage, login or chat connection.

## Requirements

### Requirement: Message from the URL

The system SHALL render the `message` query parameter at `/sources/flagbanner`, one flag per user-perceived character (an emoji is one flag). Spaces SHALL leave a gap instead of a flag. Runs of whitespace SHALL collapse to one space. The message SHALL be capped at 40 characters across both lines. An empty or missing message SHALL render nothing.

#### Scenario: Birthday message

- **WHEN** a browser source loads `/sources/flagbanner?theme=birthday&message=Happy+Birthday+Morgan+and+Marie`
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

Each line SHALL hang from a string that curves from the left edge to the right edge of the source, fading to transparent at both ends and fully opaque wherever a flag can hang. A single string SHALL sag deeper than each of two strings. Flags SHALL be SVG, sized to the longest line and shared by both lines, and the overlay SHALL scale to the browser source's width. Every flag SHALL hang straight down from a short cord tied to the string.

#### Scenario: Two lines are shallower

- **WHEN** the message breaks onto two lines
- **THEN** each string dips less at its middle than a single string would

### Requirement: Flag styles

The `style` parameter SHALL choose the flag shape: `mono` (a single-color pennant, the default), `duo` (a swallowtail flag with a band in a second color), or `circle` (a disc on a short string). An unknown style SHALL fall back to `mono`.

### Requirement: Themes

The `theme` parameter SHALL choose the colors: `birthday-dark` (the default), `birthday-light`, `anniversary-gold`, `anniversary-silver` or `pastel`. `birthday` SHALL mean `birthday-dark` and `anniversary` SHALL mean `anniversary-gold`. An unknown theme SHALL fall back to the default. Flag colors SHALL cycle letter by letter through the theme.

#### Scenario: Fixed color

- **WHEN** the theme is `color-ff00ff`
- **THEN** every flag is `#ff00ff`, and a duo band is a darker shade of it

#### Scenario: Several fixed colors

- **WHEN** the theme is `color-ff00ff-00aaff`
- **THEN** the flags alternate between the two colors (3-digit hex is accepted too)

### Requirement: One letter tone per theme

Letters SHALL be black at 85% opacity or white at 85% opacity, the same for every flag in a theme. Each named theme's colors SHALL be chosen to suit its one tone. For a fixed-color theme, the tone SHALL be whichever reads best on its least-contrasting color.

### Requirement: Google font

The `font` parameter SHALL load any Google Fonts family by name (letters, digits and spaces only). The `weight` parameter SHALL take a name, not a number: `light`, `medium`, `bold` or `black`. Without `font`, letters SHALL use Poppins bold. A custom font without `weight` SHALL use the family's regular cut. An invalid name SHALL fall back to Poppins. The family's regular cut SHALL always load alongside the chosen weight, so a weight the family lacks falls back to the nearest one instead of a system font.

### Requirement: Configuration page

The system SHALL offer a page at `/widgets/flagbanner`, listed under Widgets, in two columns: settings on the left; on the right a live preview of the banner on a 16:9 stream frame and the OBS URL. The settings SHALL cover the message, theme (including custom hex colors), flag style, font and weight. Fonts SHALL offer four featured looks (sans serif, serif, script, marker), each shown in its own typeface, plus a searchable list of the whole Google Fonts catalog that also accepts any typed name. Weights SHALL be offered by name, and only those the chosen family ships. The URL SHALL carry only the message plus the parameters that differ from the defaults.

#### Scenario: Copy a configured URL

- **WHEN** the streamer picks Anniversary (gold), Swallowtail and Playfair Display at Bold
- **THEN** the page shows `/sources/flagbanner?message=…&theme=anniversary-gold&style=duo&font=Playfair+Display&weight=bold` with a copy button
