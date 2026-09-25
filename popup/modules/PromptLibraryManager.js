/**
 * 触触搜 Popup - 提示词库管理器
 * 负责管理用户的提示词库，支持跨设备同步
 *
 * @module popup/modules/PromptLibraryManager
 */

class PromptLibraryManager {
  constructor(options = {}) {
    this.onToast = options.onToast || ((msg) => console.log(msg));
    this.storageKey = globalThis.CCSStorageKeys.PROMPT_LIBRARY;
    this.maxPrompts = 100;
    this.maxNameLength = 50;
    this.maxContentLength = 2000;
    this.currentPrompts = [];
    this.editingPromptId = null;

    // 内置提示词
    this.builtinPrompts = [
      {
        id: 'builtin-comprehensive-analysis',
        name: '综合分析',
        content: '请您尽量综合考虑，并且：进行综合分析，包括归类主题、提炼关键词、总结重点思想，并突出亮点和整理完成后以结构清晰、重点突出的方式呈现。',
        isBuiltin: true,
        createdAt: 1700000000000,
        updatedAt: 1700000000000
      }
    ];
  }

  /**
   * 初始化提示词库
   */
  async init() {
    await this._ensureBuiltinPrompts();
    this._bindEvents();
    await this.renderList();
  }

  /**
   * 确保内置提示词存在
   * @private
   */
  async _ensureBuiltinPrompts() {
    const data = await this._loadFromStorage();
    let prompts = data.prompts || [];
    let needsSave = false;

    // 检查每个内置提示词是否存在
    for (const builtin of this.builtinPrompts) {
      const exists = prompts.some(p => p.id === builtin.id);
      if (!exists) {
        prompts.unshift(builtin);
        needsSave = true;
      }
    }

    if (needsSave) {
      await this._saveToStorage({ ...data, prompts });
    }

    this.currentPrompts = prompts;
  }

  /**
   * 从存储加载数据
   * @private
   */
  _loadFromStorage() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([this.storageKey], (result) => {
        const data = result[this.storageKey] || { version: 1, prompts: [] };
        resolve(data);
      });
    });
  }

  /**
   * 保存到存储
   * @private
   */
  async _saveToStorage(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set({ [this.storageKey]: data }, () => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError.message;
          if (error && error.includes('QUOTA')) {
            this.onToast('存储空间已满，请删除一些提示词');
            reject(new Error('Storage quota exceeded'));
            return;
          }
          reject(new Error(error));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * 生成唯一ID
   * @private
   */
  _generateId() {
    return 'prompt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * 加载提示词列表
   */
  async loadPrompts() {
    const data = await this._loadFromStorage();
    this.currentPrompts = data.prompts || [];
    return this.currentPrompts;
  }

  /**
   * 添加提示词
   */
  async addPrompt(name, content) {
    // 验证
    const validation = this._validatePrompt(name, content);
    if (!validation.valid) {
      this.onToast(validation.message);
      return false;
    }

    // 检查数量限制
    if (this.currentPrompts.length >= this.maxPrompts) {
      this.onToast(`最多只能保存 ${this.maxPrompts} 个提示词`);
      return false;
    }

    const newPrompt = {
      id: this._generateId(),
      name: name.trim(),
      content: content.trim(),
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.currentPrompts.push(newPrompt);

    try {
      await this._saveToStorage({ version: 1, prompts: this.currentPrompts });
      this.onToast('提示词已保存');
      await this.renderList();
      return true;
    } catch (error) {
      // 回滚
      this.currentPrompts.pop();
      return false;
    }
  }

  /**
   * 更新提示词
   */
  async updatePrompt(id, name, content) {
    const index = this.currentPrompts.findIndex(p => p.id === id);
    if (index === -1) {
      this.onToast('提示词未找到');
      return false;
    }

    const prompt = this.currentPrompts[index];
    if (prompt.isBuiltin) {
      this.onToast('内置提示词无法编辑');
      return false;
    }

    // 验证
    const validation = this._validatePrompt(name, content);
    if (!validation.valid) {
      this.onToast(validation.message);
      return false;
    }

    // 保存旧值用于回滚
    const oldPrompt = { ...prompt };

    prompt.name = name.trim();
    prompt.content = content.trim();
    prompt.updatedAt = Date.now();

    try {
      await this._saveToStorage({ version: 1, prompts: this.currentPrompts });
      this.onToast('提示词已更新');
      await this.renderList();
      return true;
    } catch (error) {
      // 回滚
      this.currentPrompts[index] = oldPrompt;
      return false;
    }
  }

  /**
   * 删除提示词
   */
  async deletePrompt(id) {
    const index = this.currentPrompts.findIndex(p => p.id === id);
    if (index === -1) {
      this.onToast('提示词未找到');
      return false;
    }

    const prompt = this.currentPrompts[index];
    if (prompt.isBuiltin) {
      this.onToast('内置提示词无法删除');
      return false;
    }

    if (!confirm(`确定要删除「${prompt.name}」吗？`)) {
      return false;
    }

    const removedPrompt = this.currentPrompts.splice(index, 1)[0];

    try {
      await this._saveToStorage({ version: 1, prompts: this.currentPrompts });
      this.onToast('提示词已删除');
      await this.renderList();
      return true;
    } catch (error) {
      // 回滚
      this.currentPrompts.splice(index, 0, removedPrompt);
      return false;
    }
  }

  /**
   * 使用提示词（复制到剪贴板）
   */
  async usePrompt(id) {
    const prompt = this.currentPrompts.find(p => p.id === id);
    if (!prompt) {
      this.onToast('提示词未找到');
      return false;
    }

    try {
      await navigator.clipboard.writeText(prompt.content);
      this.onToast(`已复制: ${prompt.name}`);
      return true;
    } catch (error) {
      this.onToast('复制失败');
      return false;
    }
  }

  /**
   * 验证提示词
   * @private
   */
  _validatePrompt(name, content) {
    if (!name || !name.trim()) {
      return { valid: false, message: '请输入提示词名称' };
    }
    if (name.trim().length > this.maxNameLength) {
      return { valid: false, message: `名称不能超过 ${this.maxNameLength} 个字符` };
    }
    if (!content || !content.trim()) {
      return { valid: false, message: '请输入提示词内容' };
    }
    if (content.trim().length > this.maxContentLength) {
      return { valid: false, message: `内容不能超过 ${this.maxContentLength} 个字符` };
    }
    return { valid: true };
  }

  /**
   * 渲染提示词列表
   */
  async renderList() {
    await this.loadPrompts();

    const countEl = document.querySelector('.prompt-count');
    if (countEl) {
      countEl.textContent = this.currentPrompts.length;
    }

    const listEl = document.querySelector('.prompt-list');
    if (!listEl) return;

    if (this.currentPrompts.length === 0) {
      listEl.innerHTML = '<div class="prompt-empty">暂无提示词</div>';
      return;
    }

    listEl.innerHTML = this.currentPrompts.map(prompt => {
      const preview = prompt.content.length > 30
        ? prompt.content.substring(0, 30) + '...'
        : prompt.content;
      const builtinBadge = prompt.isBuiltin
        ? '<span class="prompt-builtin-badge">内置</span>'
        : '';

      return `
        <div class="prompt-item" data-prompt-id="${prompt.id}">
          <div class="prompt-main" title="点击复制">
            <div class="prompt-info">
              <span class="prompt-name">${this._escapeHtml(prompt.name)}${builtinBadge}</span>
              <span class="prompt-preview">${this._escapeHtml(preview)}</span>
            </div>
          </div>
          <div class="prompt-actions">
            ${prompt.isBuiltin ? '' : `
              <button class="prompt-edit" data-prompt-id="${prompt.id}" title="编辑">✏️</button>
              <button class="prompt-delete" data-prompt-id="${prompt.id}" title="删除">🗑️</button>
            `}
          </div>
        </div>
      `;
    }).join('');

    this._bindListEvents();
  }

  /**
   * HTML转义
   * @private
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 绑定列表事件
   * @private
   */
  _bindListEvents() {
    // 点击复制
    document.querySelectorAll('.prompt-main').forEach(el => {
      el.addEventListener('click', (e) => {
        const item = e.currentTarget.closest('.prompt-item');
        const id = item.dataset.promptId;
        this.usePrompt(id);
      });
    });

    // 编辑按钮
    document.querySelectorAll('.prompt-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.promptId;
        this.showModal('edit', id);
      });
    });

    // 删除按钮
    document.querySelectorAll('.prompt-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.promptId;
        this.deletePrompt(id);
      });
    });
  }

  /**
   * 绑定全局事件
   * @private
   */
  _bindEvents() {
    // 新建按钮
    const addBtn = document.querySelector('.add-prompt-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.showModal('add'));
    }

    // 模态框取消按钮
    const cancelBtn = document.querySelector('.prompt-modal-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.hideModal());
    }

    // 模态框保存按钮
    const saveBtn = document.querySelector('.prompt-modal-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveFromModal());
    }

    // 模态框背景点击关闭
    const modal = document.getElementById('promptModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.hideModal();
        }
      });
    }

    // 字符计数
    const contentInput = document.getElementById('promptContentInput');
    if (contentInput) {
      contentInput.addEventListener('input', () => {
        const count = contentInput.value.length;
        const countEl = document.querySelector('.prompt-char-count');
        if (countEl) {
          countEl.textContent = `${count}/${this.maxContentLength}`;
          countEl.style.color = count > this.maxContentLength ? '#f44336' : '';
        }
      });
    }
  }

  /**
   * 显示模态框
   */
  showModal(mode, promptId = null) {
    const modal = document.getElementById('promptModal');
    const title = document.getElementById('promptModalTitle');
    const nameInput = document.getElementById('promptNameInput');
    const contentInput = document.getElementById('promptContentInput');
    const countEl = document.querySelector('.prompt-char-count');

    if (!modal || !nameInput || !contentInput) return;

    this.editingPromptId = null;

    if (mode === 'edit' && promptId) {
      const prompt = this.currentPrompts.find(p => p.id === promptId);
      if (!prompt) return;

      this.editingPromptId = promptId;
      title.textContent = '编辑提示词';
      nameInput.value = prompt.name;
      contentInput.value = prompt.content;
    } else {
      title.textContent = '新建提示词';
      nameInput.value = '';
      contentInput.value = '';
    }

    if (countEl) {
      countEl.textContent = `${contentInput.value.length}/${this.maxContentLength}`;
    }

    modal.style.display = 'flex';
    nameInput.focus();
  }

  /**
   * 隐藏模态框
   */
  hideModal() {
    const modal = document.getElementById('promptModal');
    if (modal) {
      modal.style.display = 'none';
    }
    this.editingPromptId = null;
  }

  /**
   * 从模态框保存
   */
  async saveFromModal() {
    const nameInput = document.getElementById('promptNameInput');
    const contentInput = document.getElementById('promptContentInput');

    if (!nameInput || !contentInput) return;

    const name = nameInput.value;
    const content = contentInput.value;

    let success;
    if (this.editingPromptId) {
      success = await this.updatePrompt(this.editingPromptId, name, content);
    } else {
      success = await this.addPrompt(name, content);
    }

    if (success) {
      this.hideModal();
    }
  }
}

// 导出到全局
window.CCSPopup = window.CCSPopup || {};
window.CCSPopup.PromptLibraryManager = PromptLibraryManager;
