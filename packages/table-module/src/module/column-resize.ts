import { DomEditor, IDomEditor, isHTMLElememt } from '@wangeditor-next/core'
import throttle from 'lodash.throttle'
import { Editor, Element as SlateElement, Transforms } from 'slate'

import { isOfType } from '../utils'
import $ from '../utils/dom'
import { TableElement } from './custom-types'
import { numberToFixed } from './helpers'
import { isFullWidthActive } from './menu/AlwaysFullWidth'

/** *
 * 计算 cell border 距离 table 左侧距离
 */
export function getCumulativeWidths(columnWidths: number[]) {
  const cumulativeWidths: number[] = []
  let totalWidth = 0

  for (const width of columnWidths) {
    totalWidth += width
    cumulativeWidths.push(totalWidth)
  }

  return cumulativeWidths
}

/** *
 * 用于计算拖动 cell 时，cell 宽度变化的比例
 */
export function getColumnWidthRatios(columnWidths: number[]) {
  const columnWidthsRatio: number[] = []
  const totalWidth = columnWidths.reduce((a, b) => a + b, 0)

  for (const width of columnWidths) {
    columnWidthsRatio.push(width / totalWidth)
  }

  return columnWidthsRatio
}

/**
 * 监听 table 内部变化，如新增行、列，删除行列等操作，引起的高度变化。
 * ResizeObserver 需要即时释放，以免引起内存泄露
 */
let resizeObserver: ResizeObserver | null = null

export function observerTableResize(editor: IDomEditor, elm: Node | undefined) {
  if (isHTMLElememt(elm)) {
    const table = elm.querySelector('table')

    if (table) {
      resizeObserver = new ResizeObserver(([{ contentRect }]) => {
        // 当非拖动引起的宽度变化，需要调整 columnWidths
        Transforms.setNodes(
          editor,
          {
            scrollWidth: contentRect.width,
            height: contentRect.height,
          } as TableElement,
          { mode: 'highest' },
        )
      })
      resizeObserver.observe(table)
    }
  }
}

export function unObserveTableResize() {
  if (resizeObserver) {
    resizeObserver?.disconnect()
    resizeObserver = null
  }
}

// 是否为光标选区行为
let isSelectionOperation = false
// 拖拽列宽相关信息
let isMouseDownForResize = false
let clientXWhenMouseDown = 0
let editorWhenMouseDown: IDomEditor | null = null
const $window = $(window)

function onMouseDown(event: Event) {
  const elem = event.target as HTMLElement
  // 判断是否为光标选区行为，对列宽变更行为进行过滤

  if (elem.closest('[data-block-type="table-cell"]')) {
    isSelectionOperation = true
  } else if (elem.tagName === 'DIV' && elem.closest('.column-resizer-item')) {
    if (editorWhenMouseDown === null) { return }

    // 记录必要信息
    isMouseDownForResize = true
    const { clientX } = event as MouseEvent

    clientXWhenMouseDown = clientX
    document.body.style.cursor = 'col-resize'
    event.preventDefault()
  }

  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  $window.on('mousemove', onMouseMove)
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  $window.on('mouseup', onMouseUp)
}

$window.on('mousedown', onMouseDown)

/**
 * 计算相邻列宽度调整（用于中间列拖动）
 * 修改为：拖拽时当前列宽度增加，其他列宽度不变，整体表格宽度增加
 */
function calculateAdjacentWidths(columnWidths: number[], resizingIndex: number, widthChange: number, editor: IDomEditor): number[] {
  const newWidths = [...columnWidths]

  // 获取最小宽度配置
  const { minWidth = 60 } = editor.getMenuConfig('insertTable')
  const minColumnWidth = parseInt(minWidth.toString(), 10) || 60

  // 直接增加当前列的宽度，其他列保持不变
  const currentWidth = newWidths[resizingIndex]
  const newWidth = Math.max(minColumnWidth, currentWidth + widthChange) // 确保不小于最小宽度

  newWidths[resizingIndex] = Math.floor(newWidth * 100) / 100

  return newWidths
}

/**
 * 根据鼠标位置计算列宽度
 * 修改为：拖拽时当前列宽度增加，其他列宽度不变，整体表格宽度增加
 * @param columnWidths 当前列宽度数组
 * @param resizingIndex 正在调整的边界索引
 * @param mousePositionInTable 鼠标相对于表格左边的位置
 * @param cumulativeWidths 列宽度的累积和数组
 * @param editor 编辑器实例
 * @returns 调整后的列宽度数组
 */
function calculateAdjacentWidthsByBorderPosition(
  columnWidths: number[],
  resizingIndex: number,
  mousePositionInTable: number,
  cumulativeWidths: number[],
  editor: IDomEditor,
): number[] {
  const newWidths = [...columnWidths]

  if (resizingIndex < 0 || resizingIndex >= columnWidths.length) {
    return newWidths
  }

  // 获取最小宽度配置
  const { minWidth = 60 } = editor.getMenuConfig('insertTable')
  const minColumnWidth = parseInt(minWidth.toString(), 10) || 60

  // 判断是否为全宽模式
  if (!isFullWidthActive(editor)) {
    // 非全宽模式，使用原有逻辑：只调整当前列宽度，表格整体宽度变化
    const targetBorderPosition = mousePositionInTable
    const leftBoundary = resizingIndex === 0 ? 0 : cumulativeWidths[resizingIndex - 1]
    const newColumnWidth = targetBorderPosition - leftBoundary
    const adjustedWidth = Math.max(minColumnWidth, newColumnWidth)

    newWidths[resizingIndex] = numberToFixed(Math.floor(adjustedWidth * 100) / 100)
    return newWidths
  }

  // 全宽模式，需要调整相邻元素宽度以保持表格总宽度不变
  const targetBorderPosition = mousePositionInTable
  const leftBoundary = resizingIndex === 0 ? 0 : cumulativeWidths[resizingIndex - 1]
  const newColumnWidth = targetBorderPosition - leftBoundary
  const adjustedWidth = Math.max(minColumnWidth, newColumnWidth)

  // 计算宽度变化量
  const widthChange = adjustedWidth - columnWidths[resizingIndex]

  // 设置当前列的新宽度
  newWidths[resizingIndex] = numberToFixed(Math.floor(adjustedWidth * 100) / 100)

  // 调整相邻元素宽度以补偿变化
  if (Math.abs(widthChange) < 0.1) { // 避免微小变化
    return newWidths
  }

  if (widthChange > 0) {
    // 当前列宽度增加，需要减少其他列宽度
    // 优先调整右侧相邻列，如果不存在则调整左侧
    if (resizingIndex + 1 < columnWidths.length) {
      // 调整右侧相邻列
      const rightColumnNewWidth = Math.max(minColumnWidth, columnWidths[resizingIndex + 1] - widthChange)

      newWidths[resizingIndex + 1] = numberToFixed(Math.floor(rightColumnNewWidth * 100) / 100)
    } else if (resizingIndex > 0) {
      // 调整左侧相邻列
      const leftColumnNewWidth = Math.max(minColumnWidth, columnWidths[resizingIndex - 1] - widthChange)

      newWidths[resizingIndex - 1] = numberToFixed(Math.floor(leftColumnNewWidth * 100) / 100)
    }
    return newWidths
  }

  // 当前列宽度减少，需要增加其他列宽度
  // 优先调整右侧相邻列，如果不存在则调整左侧
  if (resizingIndex + 1 < columnWidths.length) {
    // 调整右侧相邻列
    const rightColumnNewWidth = columnWidths[resizingIndex + 1] - widthChange

    newWidths[resizingIndex + 1] = numberToFixed(Math.floor(rightColumnNewWidth * 100) / 100)
  } else if (resizingIndex > 0) {
    // 调整左侧相邻列
    const leftColumnNewWidth = columnWidths[resizingIndex - 1] - widthChange

    newWidths[resizingIndex - 1] = numberToFixed(Math.floor(leftColumnNewWidth * 100) / 100)
  }

  return newWidths
}

const onMouseMove = throttle((event: Event) => {
  if (!isMouseDownForResize) { return }
  if (editorWhenMouseDown === null) { return }
  event.preventDefault()

  const { clientX } = event as MouseEvent
  const widthChange = clientX - clientXWhenMouseDown // 计算宽度变化

  const [[elemNode]] = Editor.nodes(editorWhenMouseDown, {
    match: isOfType(editorWhenMouseDown, 'table'),
  })
  const { columnWidths = [], resizingIndex = -1 } = elemNode as TableElement

  let adjustColumnWidths: number[]
  const tableNode = DomEditor.getSelectedNodeByType(editorWhenMouseDown, 'table') as TableElement
  const tableDom = DomEditor.toDOMNode(editorWhenMouseDown, tableNode)

  // 所有列都采用相同的拖拽逻辑：当前列宽度增加，其他列不变
  const tableElement = tableDom.querySelector('.table')

  if (tableElement) {
    const tableRect = tableElement.getBoundingClientRect()
    const mousePositionInTable = clientX - tableRect.left // 鼠标相对于表格左边的位置

    // 计算边界的新位置
    const cumulativeWidths = getCumulativeWidths(columnWidths)

    // 根据新的边界位置计算列宽度
    adjustColumnWidths = calculateAdjacentWidthsByBorderPosition(
      columnWidths,
      resizingIndex,
      mousePositionInTable,
      cumulativeWidths,
      editorWhenMouseDown,
    )
  } else {
    // 如果找不到表格元素，则使用简单的宽度变化逻辑
    adjustColumnWidths = calculateAdjacentWidths(columnWidths, resizingIndex, widthChange, editorWhenMouseDown)
  }

  // 移除容器宽度限制，允许表格宽度超过编辑器宽度，显示横向滚动条

  // 应用新的列宽度
  Transforms.setNodes(editorWhenMouseDown, { columnWidths: adjustColumnWidths } as TableElement, {
    mode: 'highest',
  })
}, 100)

function onMouseUp(_event: Event) {
  isSelectionOperation = false
  isMouseDownForResize = false
  editorWhenMouseDown = null
  document.body.style.cursor = ''

  // 解绑事件
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  $window.off('mousemove', onMouseMove)
  // eslint-disable-next-line @typescript-eslint/no-use-before-define
  $window.off('mouseup', onMouseUp)
}
/**
 * 鼠标移动时，判断在哪个 Cell border 上
 * Class 先 visible 后 highlight @跟随飞书
 * 避免光标选区功能收到干扰
 */
export function handleCellBorderVisible(
  editor: IDomEditor,
  elemNode: SlateElement,
  e: MouseEvent,
  scrollWidth: number,
) {
  if (editor.isDisabled()) { return }
  if (isSelectionOperation || isMouseDownForResize) { return }

  const {
    width: tableWidth = 'auto',
    columnWidths = [],
    isHoverCellBorder,
    resizingIndex,
  } = elemNode as TableElement

  // Cell Border 宽度为 10px
  const { clientX, target } = e
  // 当单元格合并的时候，鼠标在 cell 中间，则不显示 cell border

  if (isHTMLElememt(target)) {
    const rect = target.getBoundingClientRect()

    if (clientX > rect.x + 5 && clientX < rect.x + rect.width - 5) {
      if (isHoverCellBorder) {
        Transforms.setNodes(
          editor,
          { isHoverCellBorder: false, resizingIndex: -1 } as TableElement,
          { mode: 'highest' },
        )
      }
      return
    }
  }
  if (isHTMLElememt(target)) {
    const parent = target.closest('.table')

    if (parent) {
      // eslint-disable-next-line @typescript-eslint/no-shadow
      const { clientX } = e
      const rect = parent.getBoundingClientRect()
      const widths = tableWidth === '100%'
        ? getColumnWidthRatios(columnWidths).map(v => v * scrollWidth)
        : columnWidths

      const cumulativeWidths = getCumulativeWidths(widths)

      // 鼠标移动时，计算当前鼠标位置，判断在哪个 Cell border 上
      for (let i = 0; i < cumulativeWidths.length; i += 1) {
        if (
          clientX - rect.x >= cumulativeWidths[i] - 5
          && clientX - rect.x < cumulativeWidths[i] + 5
        ) {
          // 节流，防止多次引起Transforms.setNodes重绘
          if (resizingIndex === i) { return }
          Transforms.setNodes(
            editor,
            { isHoverCellBorder: true, resizingIndex: i } as TableElement,
            { mode: 'highest' },
          )
          return
        }
      }
    }
  }

  // 鼠标移出时，重置
  if (isHoverCellBorder === true) {
    Transforms.setNodes(editor, { isHoverCellBorder: false, resizingIndex: -1 } as TableElement, {
      mode: 'highest',
    })
  }
}

/**
 * 设置 class highlight
 * 将 render-cell.tsx 拖动功能迁移至 div.column-resize
 */
export function handleCellBorderHighlight(editor: IDomEditor, e: MouseEvent) {
  if (e.type === 'mouseenter') {
    Transforms.setNodes(editor, { isResizing: true } as TableElement, { mode: 'highest' })
  } else {
    Transforms.setNodes(editor, { isResizing: false } as TableElement, { mode: 'highest' })
  }
}

export function handleCellBorderMouseDown(editor: IDomEditor, _elemNode: SlateElement) {
  if (isMouseDownForResize) { return } // 此时正在修改列宽
  editorWhenMouseDown = editor
}
