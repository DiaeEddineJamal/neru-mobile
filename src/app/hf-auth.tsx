// The Hugging Face sign-in returns to neru://hf-auth. The in-app browser already handed the result to
// Pocket Lab, so when the router also opens this route, step straight back to where the user was.
import { router } from 'expo-router';
import { useEffect } from 'react';

export default function HuggingFaceReturn() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/models');
  }, []);
  return null;
}
