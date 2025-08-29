(() => {
  'use strict';

  // 确保全局命名空间存在
  window.CCSModules = window.CCSModules || {};

  // Positioning 模块 - 弹窗位置计算
  const Positioning = {
    // 默认配置
    config: {
      minCursorDistance: 60,    // 距离光标的最小安全距离
      viewportPadding: 10,       // 距离视口边缘的内边距
      selectionOffset: 24,       // 距离选区的偏移
      inputFieldOffset: 28,      // 输入框中的偏移
      cursorOffset: 50,          // 距离光标的最小偏移
    },

    // 检测光标在视口的哪个象限
    getViewportQuadrant(x, y) {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      
      // 转换为视口相对坐标
      const relX = x - scrollX;
      const relY = y - scrollY;
      
      const isLeft = relX < viewportWidth / 2;
      const isTop = relY < viewportHeight / 2;
      
      if (isTop && isLeft) return 'top-left';
      if (isTop && !isLeft) return 'top-right';
      if (!isTop && isLeft) return 'bottom-left';
      return 'bottom-right';
    },

    // 计算位置得分（越高越好）
    scorePosition(pos, cursorX, cursorY, selectionRect, popoverWidth, popoverHeight) {
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      let score = 0;
      
      // 1. 距离光标的距离（越远越好，最重要）
      const cursorDist = Math.sqrt(
        Math.pow(pos.x + popoverWidth/2 - cursorX, 2) + 
        Math.pow(pos.y + popoverHeight/2 - cursorY, 2)
      );
      const minCursorDist = this.config.minCursorDistance;
      if (cursorDist >= minCursorDist) {
        score += Math.min(cursorDist / 100, 5) * 100; // 最高500分
      } else {
        score -= (minCursorDist - cursorDist) * 10; // 太近扣分
      }
      
      // 2. 是否完全在视口内（重要）
      const padding = this.config.viewportPadding;
      const left = pos.x - scrollX;
      const top = pos.y - scrollY;
      const right = left + popoverWidth;
      const bottom = top + popoverHeight;
      
      if (left >= padding && top >= padding && 
          right <= viewportWidth - padding && 
          bottom <= viewportHeight - padding) {
        score += 200; // 完全在视口内加200分
      } else {
        // 部分超出视口扣分
        const overflowLeft = Math.max(0, padding - left);
        const overflowTop = Math.max(0, padding - top);
        const overflowRight = Math.max(0, right - (viewportWidth - padding));
        const overflowBottom = Math.max(0, bottom - (viewportHeight - padding));
        const totalOverflow = overflowLeft + overflowTop + overflowRight + overflowBottom;
        score -= totalOverflow * 2;
      }
      
      // 3. 是否与选区重叠（如果有选区）
      if (selectionRect) {
        const overlap = !(
          pos.x + popoverWidth < selectionRect.left + scrollX - 10 ||
          pos.x > selectionRect.right + scrollX + 10 ||
          pos.y + popoverHeight < selectionRect.top + scrollY - 10 ||
          pos.y > selectionRect.bottom + scrollY + 10
        );
        if (!overlap) {
          score += 100; // 不重叠加100分
        }
      }
      
      return score;
    },

    // 智能定位算法（增强版）
    calculateSmartPosition(selectionRect, mouseX, mouseY, settings = {}) {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      
      console.log('[触触搜] calculateSmartPosition 输入:', {
        selectionRect: selectionRect ? {
          top: selectionRect.top,
          bottom: selectionRect.bottom,
          left: selectionRect.left,
          right: selectionRect.right
        } : null,
        mouseX, mouseY,
        viewport: { width: viewportWidth, height: viewportHeight },
        scroll: { x: scrollX, y: scrollY }
      });
      
      // 根据模式调整尺寸
      // Mini模式宽度根据按钮数量自适应：每个按钮约44px + 间距6px + padding 20px
      const miniButtonCount = settings.miniButtons?.length || 5;
      const popoverWidth = settings.mode === 'mini' ? 
        (miniButtonCount * 50 + 20) : 320;
      const popoverHeight = settings.mode === 'mini' ? 120 : 400;
      
      // 获取光标所在象限
      const quadrant = this.getViewportQuadrant(mouseX, mouseY);
      console.log('[触触搜] 光标象限:', quadrant);
      
      // 使用传入的鼠标位置
      const anchorX = mouseX;
      const anchorY = mouseY;
      
      // 检查是否在输入框内选中文本
      const activeElement = document.activeElement;
      const isInInputField = activeElement && (
        activeElement.tagName === 'INPUT' ||
        activeElement.tagName === 'TEXTAREA' ||
        activeElement.contentEditable === 'true'
      );
      
      // 定义偏移量
      const cursorOffset = this.config.cursorOffset;
      const selectionOffset = isInInputField ? 
        this.config.inputFieldOffset : 
        this.config.selectionOffset;
      
      // 定义所有候选位置
      const candidatePositions = [];
      
      // 根据象限决定优先位置
      if (quadrant === 'top-left') {
        // 优先放在右下
        candidatePositions.push(
          { x: anchorX + cursorOffset, y: anchorY + cursorOffset },
          { x: anchorX + cursorOffset, y: anchorY - popoverHeight - cursorOffset },
          { x: anchorX - popoverWidth - cursorOffset, y: anchorY + cursorOffset }
        );
      } else if (quadrant === 'top-right') {
        // 优先放在左下
        candidatePositions.push(
          { x: anchorX - popoverWidth - cursorOffset, y: anchorY + cursorOffset },
          { x: anchorX - popoverWidth - cursorOffset, y: anchorY - popoverHeight - cursorOffset },
          { x: anchorX + cursorOffset, y: anchorY + cursorOffset }
        );
      } else if (quadrant === 'bottom-left') {
        // 优先放在右上
        candidatePositions.push(
          { x: anchorX + cursorOffset, y: anchorY - popoverHeight - cursorOffset },
          { x: anchorX + cursorOffset, y: anchorY + cursorOffset },
          { x: anchorX - popoverWidth - cursorOffset, y: anchorY - popoverHeight - cursorOffset }
        );
      } else {
        // bottom-right: 优先放在左上
        candidatePositions.push(
          { x: anchorX - popoverWidth - cursorOffset, y: anchorY - popoverHeight - cursorOffset },
          { x: anchorX - popoverWidth - cursorOffset, y: anchorY + cursorOffset },
          { x: anchorX + cursorOffset, y: anchorY - popoverHeight - cursorOffset }
        );
      }
      
      // 如果有选区，基于选区添加候选位置
      if (selectionRect) {
        const selCenterX = (selectionRect.left + selectionRect.right) / 2 + scrollX;
        const selCenterY = (selectionRect.top + selectionRect.bottom) / 2 + scrollY;
        
        // 选区下方（首选）
        candidatePositions.unshift({
          x: selCenterX - popoverWidth / 2,
          y: selectionRect.bottom + scrollY + selectionOffset
        });
        
        // 选区上方
        candidatePositions.push({
          x: selCenterX - popoverWidth / 2,
          y: selectionRect.top + scrollY - popoverHeight - selectionOffset
        });
      }
      
      // 评分并选择最佳位置
      let bestPosition = null;
      let bestScore = -Infinity;
      
      for (const pos of candidatePositions) {
        const score = this.scorePosition(pos, mouseX, mouseY, selectionRect, popoverWidth, popoverHeight);
        console.log('[触触搜] 候选位置评分:', { pos, score });
        
        if (score > bestScore) {
          bestScore = score;
          bestPosition = pos;
        }
      }
      
      // 如果找到合适位置
      if (bestPosition && bestScore > 0) {
        console.log('[触触搜] calculateSmartPosition 输出（最佳）:', { 
          position: bestPosition, 
          score: bestScore,
          popoverSize: { width: popoverWidth, height: popoverHeight }
        });
        return bestPosition;
      }
      
      // 降级方案：根据象限放在对角
      let fallbackX, fallbackY;
      if (quadrant === 'top-left') {
        // 光标在左上，放在右下区域
        fallbackX = scrollX + viewportWidth - popoverWidth - 20;
        fallbackY = scrollY + viewportHeight - popoverHeight - 20;
      } else if (quadrant === 'top-right') {
        // 光标在右上，放在左下区域
        fallbackX = scrollX + 20;
        fallbackY = scrollY + viewportHeight - popoverHeight - 20;
      } else if (quadrant === 'bottom-left') {
        // 光标在左下，放在右上区域
        fallbackX = scrollX + viewportWidth - popoverWidth - 20;
        fallbackY = scrollY + 20;
      } else {
        // 光标在右下，放在左上区域
        fallbackX = scrollX + 20;
        fallbackY = scrollY + 20;
      }
      
      // 确保备用位置在视口内
      fallbackX = Math.max(scrollX + 10, Math.min(fallbackX, scrollX + viewportWidth - popoverWidth - 10));
      fallbackY = Math.max(scrollY + 10, Math.min(fallbackY, scrollY + viewportHeight - popoverHeight - 10));

      console.log('[触触搜] calculateSmartPosition 输出（备用）:', { 
        x: fallbackX, 
        y: fallbackY, 
        popoverSize: { width: popoverWidth, height: popoverHeight },
        quadrant: quadrant,
        reason: '使用备用位置'
      });

      return { x: fallbackX, y: fallbackY };
    },

    // 获取元素的绝对位置
    getAbsolutePosition(element) {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
        width: rect.width,
        height: rect.height
      };
    },

    // 确保位置在视口内
    ensureInViewport(x, y, width, height) {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const padding = this.config.viewportPadding;
      
      // 调整x坐标
      let adjustedX = x;
      if (x - scrollX < padding) {
        adjustedX = scrollX + padding;
      } else if (x + width - scrollX > viewportWidth - padding) {
        adjustedX = scrollX + viewportWidth - width - padding;
      }
      
      // 调整y坐标
      let adjustedY = y;
      if (y - scrollY < padding) {
        adjustedY = scrollY + padding;
      } else if (y + height - scrollY > viewportHeight - padding) {
        adjustedY = scrollY + viewportHeight - height - padding;
      }
      
      return { x: adjustedX, y: adjustedY };
    },

    // 设置配置
    setConfig(newConfig) {
      this.config = { ...this.config, ...newConfig };
    }
  };

  // 导出模块
  window.CCSModules.Positioning = Positioning;
  
  // 导出全局函数以保持兼容性
  window.getViewportQuadrant = (x, y) => Positioning.getViewportQuadrant(x, y);
  window.scorePosition = (pos, cursorX, cursorY, selectionRect, popoverWidth, popoverHeight) => 
    Positioning.scorePosition(pos, cursorX, cursorY, selectionRect, popoverWidth, popoverHeight);
  window.calculateSmartPosition = (selectionRect, mouseX, mouseY) => 
    Positioning.calculateSmartPosition(selectionRect, mouseX, mouseY, window.settings || {});
})();