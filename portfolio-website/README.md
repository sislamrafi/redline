# redlinez.org

The Redline landing page. Plain static HTML/CSS/JS: no build step, no dependencies.

```
index.html   page markup
styles.css   all styles (light page, dark agents/download section, responsive, reduced-motion)
main.js      hero animation, typing demo, agent config tabs, copy buttons, pixel dither band
assets/      icon + screenshots (copied from desktop-app/build/icon and docs/images)
CNAME        custom domain for GitHub Pages
```

## Preview locally

```bash
python3 -m http.server 5179 -d portfolio-website
```

Then open http://localhost:5179.

## Deploy

Any static host works. Point it at the `portfolio-website/` folder:

- **GitHub Pages:** deploy the `portfolio-website/` folder (e.g. with `actions/upload-pages-artifact`), then set the custom domain to `redlinez.org`.
- **Netlify / Cloudflare Pages / Vercel:** base directory `portfolio-website`, no build command, publish directory `.`.

Download buttons link to the latest GitHub Release, so publishing a new release updates the site automatically.
