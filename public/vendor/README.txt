OPTIONAL but recommended: self-host Three.js so the 3D scenes do not depend on an outside website.
1. Download https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
2. Save it as public/vendor/three.min.js
If this file is missing, the app loads Three.js from the cdnjs CDN. If both fail, the 3D box is simply hidden and everything else works.
