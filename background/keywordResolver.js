function pickFirstMeaningfulText(candidates) {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return { raw: candidate, trimmed };
    }
  }
  return { raw: '', trimmed: '' };
}

async function computeSearchTextForTab({
  tabId,
  tabUrl,
  tabTitle = '',
  selectionText = ''
}) {
  const candidates = [];

  if (typeof selectionText === 'string') {
    const trimmedSelection = selectionText.trim();
    if (trimmedSelection.length > 0) {
      candidates.push(selectionText);
    }
  }

  if (tabId != null && typeof selectedTextByTab === 'object' && selectedTextByTab) {
    const stored = selectedTextByTab[tabId];
    if (
      stored &&
      typeof stored.text === 'string' &&
      stored.text.trim().length > 0 &&
      (!stored.url || stored.url === tabUrl)
    ) {
      candidates.push(stored.text);
    }
  }

  if (tabUrl) {
    try {
      const extracted = await extractSearchKeywords(tabUrl, { url: tabUrl, title: tabTitle });
      if (typeof extracted === 'string' && extracted.trim().length > 0) {
        candidates.push(extracted);
      }
    } catch (error) {
      console.warn('[触触搜][BG] extractSearchKeywords失败:', error);
    }
  }

  const { raw, trimmed } = pickFirstMeaningfulText(candidates);
  const normalizedSource = trimmed || raw;
  return {
    raw,
    normalized: normalizeSearchText(normalizedSource)
  };
}

