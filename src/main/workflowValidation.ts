import type { LibraryOrganization, PdfInk } from '../shared/types'
import { object, validId } from './validation'

const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])
function fields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Invalid workflow fields')
}
export function validateCategoryId(value: unknown): asserts value is string {
  validId(value)
  if (unsafeKeys.has(value.toLowerCase())) throw new Error('Invalid identifier')
}
export function validateCategoryName(value: unknown): string {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new Error('Invalid category name')
  const name = value.trim()
  if (!name || name.length > 80) throw new Error('Category name must contain between 1 and 80 characters')
  return name
}
export function validateAssignment(paperId: unknown, categoryId: unknown): void {
  validateCategoryId(paperId)
  if (categoryId !== null) validateCategoryId(categoryId)
}
export function validateLibraryOrganization(value: unknown): asserts value is LibraryOrganization {
  object(value); fields(value, ['categories', 'assignments'])
  if (!Array.isArray(value.categories) || value.categories.length > 500) throw new Error('Invalid category count or category limit exceeded')
  object(value.assignments)
  if (Object.keys(value.assignments).length > 100_000) throw new Error('Assignment limit exceeded')
  const ids = new Set<string>(); const names = new Set<string>()
  for (const category of value.categories) {
    object(category); fields(category, ['id', 'name']); validateCategoryId(category.id)
    const name = validateCategoryName(category.name)
    if (name !== category.name || ids.has(category.id) || names.has(name.toLowerCase())) throw new Error('Invalid duplicate or untrimmed category')
    ids.add(category.id); names.add(name.toLowerCase())
  }
  for (const [paperId, categoryId] of Object.entries(value.assignments)) {
    validateAssignment(paperId, categoryId)
    if (typeof categoryId !== 'string' || !ids.has(categoryId)) throw new Error('Invalid category assignment')
  }
}
function finite(value: unknown, min: number, max: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid PDF ink geometry')
}
export function validatePdfInk(value: unknown): asserts value is PdfInk {
  object(value); fields(value, ['strokes'])
  if (!Array.isArray(value.strokes) || value.strokes.length > 1000) throw new Error('Invalid PDF ink or stroke limit exceeded')
  const ids = new Set<string>(); let totalPoints = 0
  for (const stroke of value.strokes) {
    object(stroke); fields(stroke, ['id', 'page', 'points', 'color', 'width']); validId(stroke.id)
    if (ids.has(stroke.id)) throw new Error('Invalid duplicate PDF ink identifier')
    ids.add(stroke.id)
    if (!Number.isInteger(stroke.page) || (stroke.page as number) < 1 || (stroke.page as number) > 100_000) throw new Error('Invalid PDF ink page')
    if (typeof stroke.color !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(stroke.color)) throw new Error('Invalid PDF ink color')
    finite(stroke.width, Number.MIN_VALUE, 0.1)
    if (!Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 10_000) throw new Error('Invalid PDF ink points or point limit exceeded')
    totalPoints += stroke.points.length
    if (totalPoints > 200_000) throw new Error('PDF ink point limit exceeded')
    for (const point of stroke.points) {
      object(point); fields(point, ['x', 'y']); finite(point.x, 0, 1); finite(point.y, 0, 1)
    }
  }
}
