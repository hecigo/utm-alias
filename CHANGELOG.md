# Changelog

## 0.1.0

First release. Extracted from the link layer running on two production sites on
different stacks, so the shape has already survived one port.

What it does: turns a short alias into a tagged URL whose `utm_medium` is a value
GA4 groups into a named channel. What it does not do: redirect. There is no
Worker and no service here, only the decision layer.

Version 0.x on purpose. The place table is the part most likely to need a change
once someone uses it against a setup we have not seen, and that change would be
breaking.
