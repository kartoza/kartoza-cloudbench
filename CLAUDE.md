- whenever I ask you to add a feature it should be split into three:

1. Non user facing application logic goes in the core library
2. Implementation for the Web UI
3. Implementation of the TUI

## Web Development Workflow

After making changes to the web frontend (`web/` directory):
1. Always run `npm run build` in the `web/` directory
2. Always restart the Go server after building - the server embeds static files and won't pick up changes without a restart
3. Verify the new assets are being served by checking: `curl -s http://localhost:8080/ | grep -o 'index-[^"]*\.js'`
4. The asset filename hash should change after each build if code changed

When debugging frontend issues where old code appears to be running:
- First check what the server is actually serving (curl check above)
- If serving old assets, restart the Go server
- Browser cache is rarely the issue if the asset hash changed