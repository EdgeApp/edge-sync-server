import {
  DeletedDocument,
  StoreDocument,
  StoreFileDocument
} from '../../src/types/store-types'

interface FixtureTemplate {
  [key: string]: CaseTemplate
}

interface CaseTemplate {
  conflicted: CaseTemplateMap
  resolved: CaseTemplateMap
}

interface CaseTemplateMap {
  [fileDescriptor: string]: FileTemplate | null
}

interface FileTemplate {
  data: string
  timestamp: number
  versions: number[]
}

interface Fixtures {
  [key: string]: Case
}

interface Case {
  conflicted: CaseMap
  resolved: CaseMap
}

interface CaseMap {
  [fileDescriptor: string]: StoreDocument | DeletedDocument
}

export const fixtures = parseFixtureTemplate({
  'Can resolve conflict by version': {
    conflicted: {
      'file@1-111': {
        data: 'winner',
        timestamp: 1000000000001,
        versions: [3, 1]
      },
      'file@1-222': {
        data: 'loser',
        timestamp: 1000000000002,
        versions: [2, 1]
      }
    },
    resolved: {
      'file@1-111': {
        data: 'winner',
        timestamp: 1000000000001,
        versions: [3, 2, 1]
      },
      'file@1-222': null
    }
  },
  'Can resolve conflict by timestamp': {
    conflicted: {
      'file@1-222': {
        data: 'winner',
        timestamp: 1000000000002,
        versions: [1]
      },
      'file@1-111': {
        data: 'loser',
        timestamp: 1000000000001,
        versions: [1]
      }
    },
    resolved: {
      'file@1-222': {
        data: 'winner',
        timestamp: 1000000000002,
        versions: [2, 1]
      },
      'file@1-111': null
    }
  },
  'Can resolve conflict by rev': {
    conflicted: {
      'file@2-222': {
        data: 'winner',
        timestamp: 1000000000001,
        versions: [1]
      },
      'file@1-111': {
        data: 'loser',
        timestamp: 1000000000001,
        versions: [1]
      }
    },
    resolved: {
      'file@2-222': {
        data: 'winner',
        timestamp: 1000000000001,
        versions: [2, 1]
      },
      'file@1-111': null
    }
  },
  'Can resolve multiple conflicts': {
    conflicted: {
      'file@2-111': {
        data: 'winner',
        timestamp: 1000000000003,
        versions: [3, 1]
      },
      'file@1-111': {
        data: 'loser',
        timestamp: 1000000000001,
        versions: [1]
      },
      'file@2-222': {
        data: 'loser',
        timestamp: 1000000000002,
        versions: [3, 1]
      },
      'file@2-333': {
        data: 'loser',
        timestamp: 1000000000004,
        versions: [2, 1]
      }
    },
    resolved: {
      'file@2-111': {
        data: 'winner',
        timestamp: 1000000000003,
        versions: [4, 3, 2, 1]
      },
      'file@1-111': null,
      'file@2-222': null,
      'file@2-333': null
    }
  }
})

function parseFixtureTemplate(fixtureTemplate: FixtureTemplate): Fixtures {
  return Object.entries(fixtureTemplate).reduce<Fixtures>(
    (fixtures, [title, template]) => {
      fixtures[title] = {
        conflicted: caseTemplateMapToCaseMap(template.conflicted),
        resolved: caseTemplateMapToCaseMap(template.resolved)
      }
      return fixtures
    },
    {}
  )
}

function caseTemplateMapToCaseMap(caseTemplateMap: CaseTemplateMap): CaseMap {
  return Object.entries(caseTemplateMap).reduce<CaseMap>(
    (caseMap, [fileDescriptor, fileTemplate]) => {
      caseMap[fileDescriptor] = parseFileTemplate(fileDescriptor, fileTemplate)
      return caseMap
    },
    {}
  )
}

function parseFileTemplate(
  descriptor: string,
  template: FileTemplate | null
): StoreFileDocument | DeletedDocument {
  if (template === null) {
    return {
      ...parseFileDescriptor(descriptor),
      _deleted: true
    }
  }

  const { data, timestamp, versions } = template

  return {
    ...parseFileDescriptor(descriptor),
    box: { iv_hex: '', encryptionType: 0, data_base64: data },
    timestamp,
    versions
  }
}

// descriptor = `${string}:${string}@${number}-${number}`
function parseFileDescriptor(
  descriptor: string
): { _id: string; _rev: string } {
  const [idPart, revPart] = descriptor.split('@')

  return { _id: idPart, _rev: revPart }
}
export function toFileDescriptor({
  _id,
  _rev
}: {
  _id: string
  _rev: string
}): string {
  return `${_id}@${_rev}`
}
