import { EdgeBox } from 'edge-sync-client'

import {
  DeletedDocument,
  StoreData,
  StoreDocument
} from '../../src/types/store-types'

interface FixtureTemplate {
  [key: string]: CaseTemplate
}

interface CaseTemplate {
  conflicted: CaseTemplateMap
  resolved: CaseTemplateMap
}

interface CaseTemplateMap {
  [fileDescriptor: string]: DocumentTemplate | null
}

type DocumentTemplate = StoreData

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
        box: dataToBox('winner'),
        timestamp: 1000000000001,
        versions: [3, 1]
      },
      'file@1-222': {
        box: dataToBox('loser'),
        timestamp: 1000000000002,
        versions: [2, 1]
      }
    },
    resolved: {
      'file@1-111': {
        box: dataToBox('winner'),
        timestamp: 1000000000001,
        versions: [3, 2, 1]
      },
      'file@1-222': null
    }
  },
  'Can resolve conflict by timestamp': {
    conflicted: {
      'file@1-222': {
        box: dataToBox('winner'),
        timestamp: 1000000000002,
        versions: [1]
      },
      'file@1-111': {
        box: dataToBox('loser'),
        timestamp: 1000000000001,
        versions: [1]
      }
    },
    resolved: {
      'file@1-222': {
        box: dataToBox('winner'),
        timestamp: 1000000000002,
        versions: [2, 1]
      },
      'file@1-111': null
    }
  },
  'Can resolve conflict by rev': {
    conflicted: {
      'file@2-222': {
        box: dataToBox('winner'),
        timestamp: 1000000000001,
        versions: [1]
      },
      'file@1-111': {
        box: dataToBox('loser'),
        timestamp: 1000000000001,
        versions: [1]
      }
    },
    resolved: {
      'file@2-222': {
        box: dataToBox('winner'),
        timestamp: 1000000000001,
        versions: [2, 1]
      },
      'file@1-111': null
    }
  },
  'Can resolve multiple conflicts': {
    conflicted: {
      'file@2-111': {
        box: dataToBox('winner'),
        timestamp: 1000000000003,
        versions: [3, 1]
      },
      'file@1-111': {
        box: dataToBox('loser'),
        timestamp: 1000000000001,
        versions: [1]
      },
      'file@2-222': {
        box: dataToBox('loser'),
        timestamp: 1000000000002,
        versions: [3, 1]
      },
      'file@2-333': {
        box: dataToBox('loser'),
        timestamp: 1000000000004,
        versions: [2, 1]
      }
    },
    resolved: {
      'file@2-111': {
        box: dataToBox('winner'),
        timestamp: 1000000000003,
        versions: [4, 3, 2, 1]
      },
      'file@1-111': null,
      'file@2-222': null,
      'file@2-333': null
    }
  },
  'Can resolve repo document conflict': {
    conflicted: {
      '/@2-111': {
        timestamp: 1000000000002,
        lastGitHash: 'abc',
        lastGitTime: 123,
        size: 0,
        sizeLastCreated: 0,
        maxSize: 0
      },
      '/@1-111': {
        timestamp: 1000000000001,
        lastGitHash: 'def',
        lastGitTime: 456,
        size: 0,
        sizeLastCreated: 0,
        maxSize: 0
      }
    },
    resolved: {
      '/@2-111': {
        timestamp: 1000000000002,
        lastGitHash: 'abc',
        lastGitTime: 123,
        size: 0,
        sizeLastCreated: 0,
        maxSize: 0
      },
      '/@1-111': null
    }
  },
  'Can resolve repo document with multiple conflicts': {
    conflicted: {
      '/@3-111': {
        timestamp: 1000000000003,
        lastGitHash: 'abc',
        lastGitTime: 123,
        size: 0,
        sizeLastCreated: 0,
        maxSize: 0
      },
      '/@1-111': {
        timestamp: 1000000000001,
        lastGitHash: 'xxx',
        lastGitTime: 404,
        size: 0,
        sizeLastCreated: 0,
        maxSize: 0
      },
      '/@2-111': {
        timestamp: 1000000000002,
        lastGitHash: 'xxx',
        lastGitTime: 404,
        size: 0,
        sizeLastCreated: 0,
        maxSize: 0
      }
    },
    resolved: {
      '/@3-111': {
        timestamp: 1000000000003,
        lastGitHash: 'abc',
        lastGitTime: 123,
        size: 0,
        sizeLastCreated: 0,
        maxSize: 0
      },
      '/@2-111': null,
      '/@1-111': null
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
    (caseMap, [fileDescriptor, template]) => {
      caseMap[fileDescriptor] = parseDocumentTemplate(fileDescriptor, template)
      return caseMap
    },
    {}
  )
}

function parseDocumentTemplate(
  descriptor: string,
  template: DocumentTemplate | null
): StoreDocument {
  const parsedDescriptor = parseDocumentDescriptor(descriptor)
  if (template === null) {
    return {
      ...parsedDescriptor,
      _deleted: true
    }
  }

  return {
    ...parsedDescriptor,
    ...template
  }
}

// descriptor = `${string}:${string}@${number}-${number}`
function parseDocumentDescriptor(
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

function dataToBox(data: string): EdgeBox {
  return { iv_hex: '', encryptionType: 0, data_base64: data }
}
