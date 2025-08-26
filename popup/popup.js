document.addEventListener('DOMContentLoaded', () => {
  // 获取当前插件状态
  chrome.storage.local.get(['enabled'], (result) => {
    const enabled = result.enabled !== false; // 默认启用
    updateToggleButton(enabled);
  });

  // 获取当前标签页并提取关键词
  initQuickSearch();

  // 处理快捷按钮点击
  document.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.currentTarget.dataset.action;
      
      switch(action) {
        case 'toggle':
          toggleExtension();
          break;
        case 'blacklist':
          toggleBlacklistSection();
          break;
      }
    });
  });

  // 为命令项添加点击复制功能
  document.querySelectorAll('.command-item code').forEach(code => {
    code.style.cursor = 'pointer';
    code.title = '点击复制命令';
    code.addEventListener('click', async (e) => {
      const command = e.target.textContent;
      try {
        await navigator.clipboard.writeText(command);
        showToast('命令已复制');
        
        // 添加复制成功动画
        e.target.style.background = '#27ae60';
        e.target.style.color = 'white';
        setTimeout(() => {
          e.target.style.background = '#f8f9fa';
          e.target.style.color = '#e74c3c';
        }, 300);
      } catch (err) {
        showToast('复制失败');
      }
    });
  });

  // 初始化黑名单
  loadBlacklist();
});

// 切换插件启用/禁用状态
function toggleExtension() {
  chrome.storage.local.get(['enabled'], (result) => {
    const currentState = result.enabled !== false;
    const newState = !currentState;
    
    chrome.storage.local.set({ enabled: newState }, () => {
      updateToggleButton(newState);
      showToast(newState ? '插件已启用' : '插件已禁用');
      
      // 通知content script状态改变
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            action: 'toggleExtension',
            enabled: newState
          }).catch(() => {
            // 忽略错误（可能content script未加载）
          });
        }
      });
    });
  });
}

// 更新切换按钮显示
function updateToggleButton(enabled) {
  const toggleBtn = document.querySelector('[data-action="toggle"]');
  if (toggleBtn) {
    const icon = toggleBtn.querySelector('.shortcut-icon');
    const label = toggleBtn.querySelector('.shortcut-label');
    
    if (enabled) {
      icon.textContent = '⚡';
      label.textContent = '点击禁用';
      toggleBtn.style.background = '#e8f5e9';
      toggleBtn.style.borderColor = '#4caf50';
    } else {
      icon.textContent = '⭕';
      label.textContent = '点击启用';
      toggleBtn.style.background = '#ffebee';
      toggleBtn.style.borderColor = '#f44336';
    }
  }
}

// 切换黑名单管理界面
function toggleBlacklistSection() {
  const blacklistSection = document.querySelector('.blacklist-section');
  const commandSection = document.querySelector('.command-section');
  
  if (blacklistSection.style.display === 'none') {
    blacklistSection.style.display = 'block';
    commandSection.style.display = 'none';
    loadBlacklist(); // 刷新黑名单列表
  } else {
    blacklistSection.style.display = 'none';
    commandSection.style.display = 'block';
  }
}

// 加载黑名单列表
function loadBlacklist() {
  chrome.storage.local.get(['ccs_settings'], (result) => {
    const settings = result.ccs_settings || { blacklist: [] };
    const blacklist = settings.blacklist || [];
    
    // 更新计数
    const countEl = document.querySelector('.blacklist-count');
    if (countEl) {
      countEl.textContent = blacklist.length;
    }
    
    // 更新列表
    const listEl = document.querySelector('.blacklist-list');
    if (listEl) {
      if (blacklist.length === 0) {
        listEl.innerHTML = '<div class="blacklist-empty">黑名单为空</div>';
      } else {
        listEl.innerHTML = blacklist.map(host => `
          <div class="blacklist-item" data-host="${host}">
            <span class="blacklist-host">${host}</span>
            <button class="blacklist-remove" data-host="${host}">移除</button>
          </div>
        `).join('');
        
        // 绑定移除按钮事件
        listEl.querySelectorAll('.blacklist-remove').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const host = e.target.dataset.host;
            removeFromBlacklist(host);
          });
        });
      }
    }
    
    // 绑定清空按钮
    const clearBtn = document.querySelector('.clear-blacklist');
    if (clearBtn) {
      clearBtn.onclick = clearAllBlacklist;
    }
  });
}

// 从黑名单移除
function removeFromBlacklist(host) {
  chrome.storage.local.get(['ccs_settings'], (result) => {
    const settings = result.ccs_settings || { blacklist: [] };
    const index = settings.blacklist.indexOf(host);
    
    if (index > -1) {
      settings.blacklist.splice(index, 1);
      chrome.storage.local.set({ ccs_settings: settings }, () => {
        showToast(`已移除: ${host}`);
        loadBlacklist(); // 刷新列表
        
        // 通知content script更新
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'updateBlacklist',
              blacklist: settings.blacklist
            }).catch(() => {});
          }
        });
      });
    }
  });
}

// 清空所有黑名单
function clearAllBlacklist() {
  if (confirm('确定要清空所有黑名单吗？')) {
    chrome.storage.local.get(['ccs_settings'], (result) => {
      const settings = result.ccs_settings || {};
      settings.blacklist = [];
      
      chrome.storage.local.set({ ccs_settings: settings }, () => {
        showToast('黑名单已清空');
        loadBlacklist(); // 刷新列表
        
        // 通知content script更新
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: 'updateBlacklist',
              blacklist: []
            }).catch(() => {});
          }
        });
      });
    });
  }
}

// 初始化快速搜索功能
async function initQuickSearch() {
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url) return;
    
    // 发送消息到background获取关键词
    chrome.runtime.sendMessage({
      action: 'extractKeywords',
      url: tab.url,
      title: tab.title
    }, (response) => {
      if (response && response.keywords) {
        showQuickSearch(response.keywords);
      }
    });
  } catch (error) {
    console.error('Error getting keywords:', error);
  }
}

// 显示快速搜索区域
function showQuickSearch(keywords) {
  const section = document.querySelector('.quick-search-section');
  const keywordText = document.querySelector('.keyword-text');
  
  if (section && keywordText && keywords) {
    keywordText.textContent = keywords;
    keywordText.title = keywords; // 完整文本显示在tooltip
    section.style.display = 'block';
    
    // 绑定搜索按钮事件
    document.querySelectorAll('.search-btn').forEach(btn => {
      btn.onclick = (e) => {
        const action = e.currentTarget.dataset.action;
        handleSearchAction(action, keywords);
      };
    });
  }
}

// 处理搜索动作
function handleSearchAction(action, keywords) {
  switch (action) {
    case 'baidu':
      chrome.tabs.create({
        url: `https://www.baidu.com/s?wd=${encodeURIComponent(keywords)}`
      });
      break;
    case 'google':
      chrome.tabs.create({
        url: `https://www.google.com/search?q=${encodeURIComponent(keywords)}`
      });
      break;
    case 'chuchusou':
      chrome.tabs.create({
        url: `https://chuchusou.com/?q=${encodeURIComponent(keywords)}`
      });
      break;
    case 'copy':
      navigator.clipboard.writeText(keywords).then(() => {
        showToast('关键词已复制');
        // 更新按钮状态
        const btn = document.querySelector('[data-action="copy"]');
        if (btn) {
          btn.style.background = '#27ae60';
          btn.style.color = 'white';
          setTimeout(() => {
            btn.style.background = '';
            btn.style.color = '';
          }, 500);
        }
      }).catch(() => {
        showToast('复制失败');
      });
      break;
  }
}

// 显示提示消息
function showToast(message) {
  // 创建toast元素
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 10px 20px;
    border-radius: 4px;
    font-size: 14px;
    z-index: 1000;
    animation: slideUp 0.3s ease-out;
  `;
  toast.textContent = message;
  
  // 添加动画样式
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideUp {
      from {
        opacity: 0;
        transform: translate(-50%, 20px);
      }
      to {
        opacity: 1;
        transform: translate(-50%, 0);
      }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(toast);
  
  // 2秒后移除
  setTimeout(() => {
    toast.style.animation = 'slideUp 0.3s ease-out reverse';
    setTimeout(() => {
      toast.remove();
      style.remove();
    }, 300);
  }, 2000);
}