# Goon

Multiple Movie and Photo Viewer.

Why? [See FAQ](FAQ.md)

# Download / Install

https://samanthajo2.github.io/goon/

Note: These builds are neither signed nor notarized so your OS
may complain. 

On MacOS, double click the `Goon.<version>.dmg` and drag the app somewhere.  Then open a terminal and type

```
xattr -d -r com.apple.quarantine path/to/Goon.app
```

You should now be able to run it.

You can also download and build yourself.
If you want to volunteer to supply a certificate for notification, open an issue.

# Development

[See here](DEVELOPMENT.md)
Also see [the To Do List](TODO.md)

## TL;DR:

Install node via [nvm](https://github.com/nvm-sh/nvm) or
[nvm-windows](https://github.com/coreybutler/nvm-windows).

```
git clone https://github.com/samanthajo2/goon.git
cd goon
npm ci
npm run build
npm run dist
```

The result should be in the `dist` folder.

# License (MIT)

## Art/Image/Media license

Images (jpg, png, svg, mp4, mkv, ogv) and archives of the same
are licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).