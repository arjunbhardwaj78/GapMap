SANDBOX-ONLY test stand-ins for mathjs, express, multer, dotenv, cors (Claude's sandbox has no internet).
NEVER copy these into your project's node_modules. On a real laptop just run `npm install`.
To use inside a Claude sandbox:  NODE_PATH=dev-tools/standin/node_modules npm test
They are tiny fakes, so passing tests here is NOT proof it works with the real libraries.
