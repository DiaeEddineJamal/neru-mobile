// Connector sign-in returns to neru://mcp-auth. The in-app browser already handed the result to the sign-in, so
// when the router also opens this route, step straight back to where the user was.
import { router } from 'expo-router';
import { useEffect } from 'react';

export default function ConnectorReturn() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/connectors');
  }, []);
  return null;
}
