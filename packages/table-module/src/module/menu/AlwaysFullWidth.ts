/**
 * @description table always become 100% width
 * @author slfk
 */

import {
  DomEditor, IButtonMenu, IDomEditor, t,
} from '@wangeditor-next/core'
import { Range, Transforms } from 'slate'

import { ALWAYS_FULL_WIDTH_SVG } from '../../constants/svg'
import { TableElement } from '../custom-types'

export const isFullWidthActive = (editor: IDomEditor) => {
  const tableNode = DomEditor.getSelectedNodeByType(editor, 'table')

  if (tableNode == null) { return false }
  return !!((tableNode as TableElement).width === '100%')
}

class TableAlwaysFullWidth implements IButtonMenu {
  readonly title = t('tableModule.alwaysFullWidth')

  readonly iconSvg = ALWAYS_FULL_WIDTH_SVG

  readonly tag = 'button'

  // 是否已设置 宽度自适应
  getValue(editor: IDomEditor): string | boolean {
    return isFullWidthActive(editor)
  }

  isActive(editor: IDomEditor): boolean {
    return !!this.getValue(editor)
  }

  isDisabled(editor: IDomEditor): boolean {
    const { selection } = editor

    if (selection == null) { return true }
    if (!Range.isCollapsed(selection)) { return true }

    const tableNode = DomEditor.getSelectedNodeByType(editor, 'table')

    if (tableNode == null) {
      // 选区未处于 table node ，则禁用
      return true
    }
    return false
  }

  exec(editor: IDomEditor, _v: string | boolean) {
    if (this.isDisabled(editor)) { return }

    if (this.isActive(editor)) {
      // 取消宽度自适应
      const props: Partial<TableElement> = {
        width: 'auto',
      }

      Transforms.setNodes(editor, props, { mode: 'highest' })
      return
    }

    const tableNode = DomEditor.getSelectedNodeByType(editor, 'table') as TableElement

    if (!tableNode) { return }

    const { columnWidths = [] } = tableNode

    // 1. 获取当前选中的表格 dom 元素的 table-container 元素
    const tableDom = DomEditor.toDOMNode(editor, tableNode)
    const containerElement = tableDom.querySelector('.table-container')

    if (!containerElement || columnWidths.length === 0) {
      return
    }

    const truthTableDoms = containerElement.getElementsByTagName('table')

    if (!truthTableDoms || truthTableDoms.length === 0) {
      return
    }

    // 2. 获取容器的最大可用宽度作为参考值
    const parentStyle = getComputedStyle(containerElement)
    const paddingLeft = parseInt(parentStyle.paddingLeft, 10) || 0
    const paddingRight = parseInt(parentStyle.paddingRight, 10) || 0

    const containerWidth = containerElement.clientWidth - paddingLeft - paddingRight

    const truthTableDom = truthTableDoms[0]
    const currentTableStyle = getComputedStyle(truthTableDom)
    const ctPaddingLeft = parseInt(currentTableStyle.paddingLeft, 10) || 0
    const ctPaddingRight = parseInt(currentTableStyle.paddingRight, 10) || 0

    // 拿当前 table 的真实宽度作为后续计算的基础
    const tryWidth = parseInt(currentTableStyle.width.replace('px', ''), 10)

    const ctWidth = Number.isNaN(tryWidth)
      ? containerWidth
      : tryWidth
    const tableCurrentWidth = Math.max(
      columnWidths.length * 60,
      ctWidth - ctPaddingLeft - ctPaddingRight,
    )

    // 3. 重新运算 columnWidths
    const newColumnWidths = columnWidths.map((width, _i) => {
      const percentage = Number(Number(width / tableCurrentWidth).toFixed(2))

      return percentage * containerWidth
    })

    // 4. 设置新的 props，width 固定为 100%，附带上新的 columnWidths
    const props: Partial<TableElement> = {
      width: '100%',
      columnWidths: newColumnWidths,
    }

    Transforms.setNodes(editor, props, { mode: 'highest' })
  }
}

export default TableAlwaysFullWidth
