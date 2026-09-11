# Changelog

## 0.1.1

Configuration codes are now checked in every table, not only destinations.

A code containing `-`, or an uppercase one, can never appear in an alias: the
parser splits on `-` and matches lowercase segments. In 0.1.0 only destination
codes were checked, so `sources: { 'my-src': 'mysite' }` built a resolver that
looked fine and then failed at resolve time with

    source "my" is not in the table. Allowed: my-src

an error naming a code that cannot be used. Sources, campaigns, places and the
test code now fail when the resolver is built, which is the last moment it is
still cheap to fix.

No change if your codes were already valid.

## 0.1.0

First release. Extracted from the link layer running on two production sites on
different stacks, so the shape has already survived one port.

What it does: turns a short alias into a tagged URL whose `utm_medium` is a value
GA4 groups into a named channel. What it does not do: redirect. There is no
Worker and no service here, only the decision layer.

Version 0.x on purpose. The place table is the part most likely to need a change
once someone uses it against a setup we have not seen, and that change would be
breaking.
