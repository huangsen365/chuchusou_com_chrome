/**
 * 触触搜 Popup - 菜单渲染器
 * 负责渲染和管理菜单结构
 *
 * @module popup/modules/MenuRenderer
 */

class MenuRenderer {
  constructor(options = {}) {
    this.containerSelector = options.containerSelector || '#menuContainer';
    this.keywordSelector = options.keywordSelector || '#currentKeyword';
    this.maxKeywordLength = options.maxKeywordLength || 15;

    this.onItemClick = options.onItemClick || null;
  }

  /**
   * 渲染菜单
   * @param {Object} config - 菜单配置
   * @param {Object} keyword - 关键词信息
   */
  render(config, keyword) {
    const container = document.querySelector(this.containerSelector);
    if (!container) return;

    container.innerHTML = '';

    // 渲染关键词
    this._renderKeyword(keyword);

    // 渲染菜单组
    if (!config || !config.groups) {
      container.innerHTML = '<div class="menu-empty">无菜单配置</div>';
      return;
    }

    config.groups.forEach((group, index) => {
      // 跳过 panel 组
      if (group.id === 'panel') return;

      // separator before
      if (group.separator === 'before' && index > 0) {
        container.appendChild(this._createSeparator());
      }

      this._renderGroup(container, group);

      // separator after
      if (group.separator === 'after') {
        container.appendChild(this._createSeparator());
      }
    });
  }

  /**
   * 渲染关键词显示
   * @private
   */
  _renderKeyword(keyword) {
    const keywordEl = document.querySelector(this.keywordSelector);
    const copyEl = document.querySelector('#currentKeywordCopy');
    if (!keywordEl) return;
    const keywordWrapEl = keywordEl.closest('.menu-keyword-wrap');

    if (keyword && keyword.text) {
      const displayText = this._formatKeyword(keyword.text);
      const fullKeyword = keyword.raw || keyword.text;
      keywordEl.textContent = `"${displayText}"`;
      // 用自定义 CSS tooltip 替代原生 title：原生 title 有浏览器级延迟，hover 体感慢。
      if (keywordWrapEl) keywordWrapEl.dataset.fullKeyword = fullKeyword;
      keywordEl.removeAttribute('title');
      keywordEl.style.display = 'block';
      if (copyEl) {
        copyEl.hidden = false;
        copyEl.dataset.keyword = fullKeyword;
      }
    } else {
      keywordEl.textContent = '';
      if (keywordWrapEl) keywordWrapEl.dataset.fullKeyword = '';
      keywordEl.removeAttribute('title');
      keywordEl.style.display = 'none';
      if (copyEl) {
        copyEl.hidden = true;
        copyEl.dataset.keyword = '';
      }
    }
  }

  /**
   * 格式化关键词显示
   * @private
   */
  _formatKeyword(text) {
    if (!text) return '';
    const compact = text.replace(/\s+/g, ' ').trim();
    return compact.length > this.maxKeywordLength
      ? compact.substring(0, this.maxKeywordLength) + '...'
      : compact;
  }

  /**
   * 创建分隔符
   * @private
   */
  _createSeparator() {
    const sep = document.createElement('div');
    sep.className = 'menu-separator';
    return sep;
  }

  /**
   * 渲染菜单组
   * @private
   */
  _renderGroup(container, group) {
    if (!group.items) return;

    group.items.forEach(item => {
      if (item.enabled === false) return;

      const itemEl = this._createMenuItem(item);
      container.appendChild(itemEl);

      // 子菜单容器
      if (item.children && item.children.length > 0) {
        const submenu = this._createSubmenu(item.children, item.id);
        container.appendChild(submenu);
      }
    });
  }

  /**
   * 创建菜单项
   * @private
   */
  _createMenuItem(item) {
    const el = document.createElement('div');
    el.className = 'menu-item';
    el.dataset.menuId = item.id;
    el.dataset.menuType = item.type || '';

    const hasChildren = item.children && item.children.length > 0;
    if (hasChildren) {
      el.classList.add('has-children');
    }

    // 获取显示标题
    let displayTitle = item.title || '';

    // 对于速答菜单，简化标题显示
    if (item.type === 'fastqa-quick') {
      const match = displayTitle.match(/- (.+)$/);
      if (match) {
        displayTitle = `速答 · ${match[1]}`;
      }
    }

    el.innerHTML = `
      <span class="item-icon">${item.icon || ''}</span>
      <span class="item-title">${displayTitle}</span>
      ${hasChildren ? '<span class="item-arrow">▶</span>' : ''}
    `;

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hasChildren) {
        this._toggleSubmenu(el, item.id);
      } else if (this.onItemClick) {
        this.onItemClick(item);
      }
    });

    return el;
  }

  /**
   * 创建子菜单
   * @private
   */
  _createSubmenu(children, parentId, level = 1) {
    const submenu = document.createElement('div');
    submenu.className = 'submenu collapsed';
    submenu.dataset.parentId = parentId;
    submenu.dataset.level = level;

    children.forEach(child => {
      if (child.enabled === false) return;

      const hasChildren = child.children && child.children.length > 0;

      const childEl = document.createElement('div');
      childEl.className = `menu-item submenu-item level-${level}`;
      childEl.dataset.menuId = child.id;
      childEl.dataset.menuType = child.type || '';

      if (hasChildren) {
        childEl.classList.add('has-children');
      }

      childEl.innerHTML = `
        <span class="item-icon">${child.icon || ''}</span>
        <span class="item-title">${child.title}</span>
        ${hasChildren ? '<span class="item-arrow">▶</span>' : ''}
      `;

      childEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (hasChildren) {
          this._toggleSubmenu(childEl, child.id);
        } else if (this.onItemClick) {
          this.onItemClick(child);
        }
      });

      submenu.appendChild(childEl);

      // 递归创建子菜单
      if (hasChildren) {
        const nestedSubmenu = this._createSubmenu(child.children, child.id, level + 1);
        submenu.appendChild(nestedSubmenu);
      }
    });

    return submenu;
  }

  /**
   * 切换子菜单展开/收起
   * @private
   */
  _toggleSubmenu(parentEl, parentId) {
    const submenu = document.querySelector(`.submenu[data-parent-id="${parentId}"]`);
    if (submenu) {
      submenu.classList.toggle('collapsed');
      parentEl.classList.toggle('expanded');
    }
  }

  /**
   * 显示错误信息
   */
  showError(message) {
    const container = document.querySelector(this.containerSelector);
    if (container) {
      container.innerHTML = `<div class="menu-error">${message}</div>`;
    }
  }
}

// 导出到全局
window.CCSPopup = window.CCSPopup || {};
window.CCSPopup.MenuRenderer = MenuRenderer;
