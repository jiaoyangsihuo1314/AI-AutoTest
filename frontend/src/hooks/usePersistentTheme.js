import { useEffect, useState } from 'react';

export function usePersistentTheme(storageKey, defaultThemeId) {
  const [themeId, setThemeId] = useState(defaultThemeId);
  useEffect(() => {
    document.documentElement.dataset.theme = themeId;
    window.localStorage?.setItem(storageKey, themeId);
  }, [storageKey, themeId]);
  return [themeId, setThemeId];
}
