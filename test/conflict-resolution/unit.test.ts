import { expect } from 'chai'

import { resolvedDocumentUpdates } from '../../src/util/store/conflict-resolution'
import { fixtures, toFileDescriptor } from './fixtures'

describe('Unit: resolvedDocumentUpdates', () => {
  for (const [title, { conflicted, resolved }] of Object.entries(fixtures)) {
    const conflictedDocuments = Object.values(conflicted)

    const permutations = getAllPermutations(
      '0123456789'.slice(0, conflictedDocuments.length)
    )

    for (const permutation of permutations) {
      it(`${title} (${permutation})`, () => {
        resolvedDocumentUpdates(
          sortByPermutation(conflictedDocuments, permutation)
        ).forEach(doc => {
          expect(doc).deep.equal(resolved[toFileDescriptor(doc)])
        })
      })
    }
  }
})

function getAllPermutations(str: string): string[] {
  const results: string[] = []

  if (str.length === 1) {
    results.push(str)
    return results
  }

  for (let i = 0; i < str.length; i++) {
    const firstChar = str[i]
    const charsLeft = str.substring(0, i) + str.substring(i + 1)
    const innerPermutations = getAllPermutations(charsLeft)
    for (let j = 0; j < innerPermutations.length; j++) {
      results.push(firstChar + innerPermutations[j])
    }
  }
  return results
}

function sortByPermutation<T>(arr: T[], permutation: string): T[] {
  const sorted: T[] = []
  for (const position of permutation) {
    const index = parseInt(position)
    sorted.push(arr[index])
  }
  return sorted
}
