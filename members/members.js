(function () {
  'use strict';

  const STATE = {
    config: null,
    expandedId: null
  };

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  async function loadConfig() {
    const url = chrome.runtime.getURL('prompts/stanleyFriends.json');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }

  function renderHeader(config) {
    if (config.categoryLabel) $('mbTitle').textContent = config.categoryLabel;
    if (config.categoryDescription) $('mbDesc').textContent = config.categoryDescription;
  }

  function renderGrid(config) {
    const grid = $('mbGrid');
    grid.innerHTML = '';
    const members = Array.isArray(config.members) ? config.members : [];

    if (members.length === 0) {
      grid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: #6b7280;">还没有成员，请在 <code>prompts/stanleyFriends.json</code> 里添加。</p>';
      grid.hidden = false;
      return;
    }

    members.forEach((m) => grid.appendChild(buildCard(m)));
    grid.hidden = false;
  }

  function buildCard(member) {
    const card = document.createElement('article');
    card.className = 'mb-card';
    card.dataset.memberId = member.id || '';

    const handles = [];
    if (member.xHandle) handles.push(`<span class="mb-card-handle">𝕏 ${escapeHtml(member.xHandle)}</span>`);
    if (member.altHandle) handles.push(`<span class="mb-card-handle">@ ${escapeHtml(member.altHandle)}</span>`);

    const avatarInner = member.avatarUrl
      ? `<img src="${escapeHtml(member.avatarUrl)}" alt="${escapeHtml(member.displayName || '')}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'🧑'}))">`
      : '🧑';

    card.innerHTML = `
      <div class="mb-card-head" role="button" tabindex="0" aria-expanded="false">
        <div class="mb-avatar">${avatarInner}</div>
        <div class="mb-card-meta">
          <div class="mb-card-name">${escapeHtml(member.displayName || member.id || '未命名')}</div>
          <div class="mb-card-handles">${handles.join('')}</div>
        </div>
        <span class="mb-card-arrow">▶</span>
      </div>
      ${member.bio ? `<div class="mb-card-bio">${escapeHtml(member.bio)}</div>` : ''}
      <div class="mb-prompts"></div>
    `;

    const head = card.querySelector('.mb-card-head');
    head.addEventListener('click', () => toggleCard(card, member));
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCard(card, member);
      }
    });

    return card;
  }

  function toggleCard(card, member) {
    const isExpanded = card.classList.contains('expanded');
    if (isExpanded) {
      card.classList.remove('expanded');
      card.querySelector('.mb-card-head').setAttribute('aria-expanded', 'false');
      STATE.expandedId = null;
      return;
    }
    card.classList.add('expanded');
    card.querySelector('.mb-card-head').setAttribute('aria-expanded', 'true');
    STATE.expandedId = member.id;
    renderPrompts(card, member);
  }

  function renderPrompts(card, member) {
    const list = card.querySelector('.mb-prompts');
    if (list.dataset.rendered === '1') return;
    const prompts = Array.isArray(member.prompts) ? member.prompts : [];

    if (prompts.length === 0) {
      list.innerHTML = '<p style="color: #6b7280; font-size: 12px; padding: 4px 0;">该成员还没有提示词。</p>';
      list.dataset.rendered = '1';
      return;
    }

    prompts.forEach((p, idx) => {
      const node = document.createElement('div');
      node.className = 'mb-prompt';
      node.innerHTML = `
        <div class="mb-prompt-head">
          <div class="mb-prompt-meta">
            <div class="mb-prompt-label">${escapeHtml(p.label || `提示词 ${idx + 1}`)}</div>
            ${p.description ? `<div class="mb-prompt-desc">${escapeHtml(p.description)}</div>` : ''}
          </div>
          <button class="mb-prompt-copy" type="button">📋 复制</button>
        </div>
        <pre class="mb-prompt-text">${escapeHtml(p.text || '')}</pre>
      `;
      const btn = node.querySelector('.mb-prompt-copy');
      btn.addEventListener('click', () => copyPrompt(btn, p.text || ''));
      list.appendChild(node);
    });
    list.dataset.rendered = '1';
  }

  async function copyPrompt(btn, text) {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '✓ 已复制';
      btn.classList.add('copied');
      showToast('已复制提示词到剪贴板。回到任意网页选中文字 → 右键菜单 / Popup pin 生成。');
      setTimeout(() => {
        btn.textContent = '📋 复制';
        btn.classList.remove('copied');
      }, 1800);
    } catch (err) {
      console.error('[触触搜] 复制失败:', err);
      showToast('复制失败，请手动选中文本复制');
    }
  }

  let toastTimer = null;
  function showToast(msg) {
    const el = $('mbToast');
    el.textContent = msg;
    el.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
  }

  async function init() {
    try {
      STATE.config = await loadConfig();
      renderHeader(STATE.config);
      renderGrid(STATE.config);
      $('mbLoading').hidden = true;
    } catch (err) {
      console.error('[触触搜] 加载 stanleyFriends.json 失败:', err);
      $('mbLoading').hidden = true;
      $('mbErrorMsg').textContent = err.message || String(err);
      $('mbError').hidden = false;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
