(function() {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};
  
  // Dragging 模块 - 拖拽功能管理
  const Dragging = {
    // 拖拽状态
    isDragging: false,
    dragOffset: { x: 0, y: 0 },
    dragTarget: null,
    originalPosition: null,
    
    // 配置
    config: {
      dragHandle: '.ccs-header',
      dragBoundary: true,
      savePosition: true,
      minOpacity: 0.3,
      dragClass: 'ccs-dragging'
    },

    // 初始化拖拽
    init(element, options = {}) {
      if (!element) return;
      
      // 合并配置
      this.config = { ...this.config, ...options };
      
      // 查找拖拽手柄
      const handle = element.querySelector(this.config.dragHandle) || element;
      
      // 绑定事件
      handle.addEventListener('mousedown', (e) => this.startDragging(e, element));
      
      // 全局事件（用于释放和移动）
      if (!this.globalEventsAttached) {
        document.addEventListener('mousemove', (e) => this.handleDragging(e));
        document.addEventListener('mouseup', () => this.stopDragging());
        this.globalEventsAttached = true;
      }
    },

    // 开始拖拽
    startDragging(e, element) {
      // 检查是否应该拖拽
      if (!this.shouldDrag(e)) return;
      
      // 阻止默认行为
      e.preventDefault();
      e.stopPropagation();
      
      // 设置拖拽状态
      this.isDragging = true;
      this.dragTarget = element;
      
      // 计算偏移
      const rect = element.getBoundingClientRect();
      this.dragOffset = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      
      // 保存原始位置
      this.originalPosition = {
        left: element.style.left,
        top: element.style.top
      };
      
      // 添加拖拽类
      element.classList.add(this.config.dragClass);
      
      // 设置拖拽时的样式
      element.style.cursor = 'grabbing';
      element.style.opacity = '0.8';
      element.style.transition = 'none';
      
      // 防止文本选择
      document.body.style.userSelect = 'none';
      
      console.log('[触触搜] 开始拖拽');
    },

    // 处理拖拽
    handleDragging(e) {
      if (!this.isDragging || !this.dragTarget) return;
      
      e.preventDefault();
      
      // 计算新位置
      let newX = e.clientX - this.dragOffset.x;
      let newY = e.clientY - this.dragOffset.y;
      
      // 边界检查
      if (this.config.dragBoundary) {
        const boundary = this.getBoundary();
        const rect = this.dragTarget.getBoundingClientRect();
        
        // 限制在视口内
        newX = Math.max(boundary.left, Math.min(newX, boundary.right - rect.width));
        newY = Math.max(boundary.top, Math.min(newY, boundary.bottom - rect.height));
      }
      
      // 应用新位置
      this.dragTarget.style.position = 'fixed';
      this.dragTarget.style.left = `${newX}px`;
      this.dragTarget.style.top = `${newY}px`;
      
      // 触发拖拽事件
      this.onDrag({ x: newX, y: newY });
    },

    // 停止拖拽
    stopDragging() {
      if (!this.isDragging) return;
      
      console.log('[触触搜] 停止拖拽');
      
      // 恢复样式
      if (this.dragTarget) {
        this.dragTarget.classList.remove(this.config.dragClass);
        this.dragTarget.style.cursor = '';
        this.dragTarget.style.opacity = '';
        this.dragTarget.style.transition = '';
        
        // 保存位置
        if (this.config.savePosition) {
          this.savePosition();
        }
        
        // 触发停止事件
        this.onDragEnd();
      }
      
      // 重置状态
      this.isDragging = false;
      this.dragTarget = null;
      this.dragOffset = { x: 0, y: 0 };
      
      // 恢复文本选择
      document.body.style.userSelect = '';
    },

    // 检查是否应该拖拽
    shouldDrag(e) {
      // 检查目标元素
      const target = e.target;
      
      // 不拖拽按钮、输入框等交互元素
      const tagName = target.tagName.toLowerCase();
      if (['button', 'input', 'textarea', 'select', 'a'].includes(tagName)) {
        return false;
      }
      
      // 检查是否有 data-draggable 属性
      const draggable = target.closest('[data-draggable]');
      if (draggable && draggable.dataset.draggable === 'false') {
        return false;
      }
      
      // 检查是否是拖拽手柄
      if (this.config.dragHandle) {
        const handle = target.closest(this.config.dragHandle);
        if (!handle) return false;
        
        // 再次检查手柄内的交互元素
        if (target.closest('button, input, textarea, select, a')) {
          return false;
        }
      }
      
      return true;
    },

    // 获取拖拽边界
    getBoundary() {
      return {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight
      };
    },

    // 保存位置
    savePosition() {
      if (!this.dragTarget) return;
      
      const rect = this.dragTarget.getBoundingClientRect();
      const position = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
      
      // 保存到设置
      const Settings = window.CCSModules?.Settings;
      if (Settings) {
        Settings.set('position', position);
      }
      
      console.log('[触触搜] 位置已保存:', position);
    },

    // 恢复位置
    restorePosition(element) {
      const Settings = window.CCSModules?.Settings;
      if (!Settings) return;
      
      const position = Settings.get('position');
      if (position) {
        element.style.position = 'fixed';
        element.style.left = `${position.left}px`;
        element.style.top = `${position.top}px`;
        
        console.log('[触触搜] 位置已恢复:', position);
      }
    },

    // 清理拖拽状态
    cleanup() {
      this.stopDragging();
      this.isDragging = false;
      this.dragTarget = null;
      this.dragOffset = { x: 0, y: 0 };
      this.originalPosition = null;
    },

    // 拖拽中的回调
    onDrag(position) {
      // 可以被覆盖
      if (this.dragCallback) {
        this.dragCallback(position);
      }
    },

    // 拖拽结束的回调
    onDragEnd() {
      // 可以被覆盖
      if (this.dragEndCallback) {
        this.dragEndCallback();
      }
    },

    // 设置回调
    setCallbacks(callbacks = {}) {
      this.dragCallback = callbacks.onDrag;
      this.dragEndCallback = callbacks.onDragEnd;
    },

    // 使元素可拖拽
    makeDraggable(element, options = {}) {
      this.init(element, options);
      
      // 添加视觉提示
      const handle = element.querySelector(this.config.dragHandle) || element;
      handle.style.cursor = 'grab';
      
      // 添加 data 属性
      handle.setAttribute('data-draggable', 'true');
    },

    // 禁用拖拽
    disableDragging(element) {
      const handle = element.querySelector(this.config.dragHandle) || element;
      handle.style.cursor = '';
      handle.setAttribute('data-draggable', 'false');
      
      // 移除事件监听器
      handle.removeEventListener('mousedown', this.startDragging);
    },

    // 检查是否正在拖拽
    isDraggingNow() {
      return this.isDragging;
    }
  };

  // 导出模块
  window.CCSModules.Dragging = Dragging;
  
  // 兼容性：导出全局函数
  window.startDragging = (e, element) => Dragging.startDragging(e, element);
  window.handleDragging = (e) => Dragging.handleDragging(e);
  window.stopDragging = () => Dragging.stopDragging();
  window.cleanupDragState = () => Dragging.cleanup();
})();