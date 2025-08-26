document.addEventListener('DOMContentLoaded', () => {
  // 获取当前插件状态
  chrome.storage.local.get(['enabled'], (result) => {
    const enabled = result.enabled !== false; // 默认启用
    updateToggleButton(enabled);
  });

  // 处理快捷按钮点击
  document.querySelectorAll('.shortcut-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const action = e.currentTarget.dataset.action;
      
      switch(action) {
        case 'toggle':
          toggleExtension();
          break;
        case 'settings':
          openSettings();
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

// 打开设置页面（预留功能）
function openSettings() {
  showToast('设置功能开发中...');
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