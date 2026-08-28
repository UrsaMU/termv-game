+PING

Street dossier — sprawl +finger. Anyone can `/ping` a handle.
You write the card with `&ping-<field>` or `+ping/set`.

SYNTAX
  +ping [<player>]
  +ping/set <field>=<value>
  +ping/set <field>=
  &ping-<field> me=<value>

STOCK FIELDS
  handle     alias on the card
  pronouns
  timezone
  prefs      RP preferences
  quote
  position

CUSTOM
  Any `&ping-foo me=bar` shows as Foo on the card.
  Hide a line with value `@@`.

SLASH
  /ping
  /ping Alice
  /ping/set pronouns=they/them
  /ping-quote Stay frosty.

SEE ALSO: +finger, +sheet
