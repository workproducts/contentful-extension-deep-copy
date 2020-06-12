import { log } from './log'

let references = {}
let referenceCount = 0
let newReferenceCount = 0
let updatedReferenceCount = 0
let region = 'en-US';
let space = null;

const statusUpdateTimeout = 3000
const waitTime = 100
const dryRun = false;

async function wait (ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

async function updateEntry (entry) {
  await wait(waitTime)

  if (!dryRun) {
    return await space.updateEntry(entry)
  }
}

async function createEntry (type, data) {
  await wait(waitTime);

  if (!dryRun) {
    return await space.createEntry(type, data)
  }
}

async function getEntry (entryId) {
  await wait(waitTime)
  return await space.getEntry(entryId)
}

async function inspectField (field) {
  if (field && Array.isArray(field)) {
    return await Promise.all(field.map(async (f) => {
      return await inspectField(f)
    }))
  }
  
  if (field && field.sys && field.sys.type === 'Link' && field.sys.linkType === 'Entry') {
    await findReferences(field.sys.id)
  }
}

async function findReferences (entryId) {
  if (references[entryId]) {
    return
  }

  const entry = await getEntry(entryId)

  referenceCount++
  references[entryId] = entry

  for (let fieldName in entry.fields) {
    const field = entry.fields[fieldName]

    for (let lang in field) {
      const langField = field[lang]
      
      await inspectField(langField)
    }
  }
}

async function createNewEntriesFromReferences (title) {
  if (!title) {
    title = 'New Toolkit';
  }

  const newEntries = {};

  for (let entryId in references) {
    const entry = references[entryId];
    const fields = entry.fields;
    const type = entry.sys.contentType.sys.id;
    let info = '';
    let skipCopy = false;

    console.log('----- '+ type +' -----');

    switch (type) {
      case 'toolkit':
        fields.title = {[region]: title};
        fields.description = {[region]: 'Description'};
        fields.synopsis = {[region]: 'Synopsis'};
        // fields.title[region] = title;
        // fields.description[region] = 'Description';
        // fields.synopsis[region] = 'Synopsis';
        delete fields.slug;
        delete fields.category;
        delete fields.titleArt;
        delete fields.launchDate;
        delete fields.distribution;

        info = fields.title[region];
      break;

      case 'toolkitAsset':
        info = fields.name[region];
        delete fields.ctaUrl;
      break;

      case 'contentModule':
        info = fields.contentType[region];
        
        // text
        delete fields.ctaUrl

        // image collection
        delete fields.images;

        // two column
        delete fields.twoColumnText1;
        delete fields.twoColumnText2;
        delete fields.twoColumnList1;
        delete fields.twoColumnList2;

        // video
        delete fields.video;
      break;

      case 'imageMetadata':
        info = fields.name[region];
      break;

      case 'tagRegion':
      case 'tagLanguage':
      case 'tagCreativeType':
        info = fields.name[region];
        skipCopy = true;
      break;

      default:
        log(`Unrecognized type ${type}`);
      break;
    }

    if (!skipCopy) {

      // global cleanup for non-reference items
      if (fields.sendForLocalization) {
        console.log('delete fields.sendForLocalization');
        delete fields.sendForLocalization;
      }
      if (fields.localizedVersion) {
        console.log('delete fields.localizedVersion');
        delete fields.localizedVersion;
      }
      if (fields.localizedDate) {
        console.log('delete fields.localizedDate');
        delete fields.localizedDate;
      }

      const newEntry = await createEntry(entry.sys.contentType.sys.id, { fields: fields })
      newReferenceCount++
      newEntries[entryId] = newEntry
      log(`New ${type}: ${info}`);

    } else {
      log(`Link: ${type}`);
    }
  }
  
  return newEntries
}

async function updateReferencesOnField(field, newReferences) {
  if (field && Array.isArray(field)) {
    return await Promise.all(field.map(async (f) => {
      return await updateReferencesOnField(f, newReferences)
    }))
  }

  if (field && field.sys && field.sys.type === 'Link' && field.sys.linkType === 'Entry') {
    const oldReference = references[field.sys.id]
    const newReference = newReferences[field.sys.id]

    // in some cases items will remain as links, so a newReference won't exist for it
    if (newReference) {
      field.sys.id = newReference.sys.id
    }
  }
}

async function updateReferenceTree(newReferences) {
  for (let entryId in newReferences) {
    const entry = newReferences[entryId]

    for (let fieldName in entry.fields) {
      const field = entry.fields[fieldName]
  
      for (let lang in field) {
        const langField = field[lang]
        
        await updateReferencesOnField(langField, newReferences)
      }
    }

    await updateEntry(entry)

    updatedReferenceCount++
  }
}

async function recursiveClone (spaceObj, entryId, title) {
  space = spaceObj;
  references = {}
  referenceCount = 0
  newReferenceCount = 0
  updatedReferenceCount = 0
  log(`Starting clone... ${dryRun ? 'DRY RUN' : ''}`)

  let statusUpdateTimer = null

  log(`Finding references recursively...`)

  statusUpdateTimer = setInterval(() => {
    log(` - found ${referenceCount} entries so far...`)
  }, statusUpdateTimeout)

  await findReferences(entryId)
  clearInterval(statusUpdateTimer)

  log(` -- Found ${referenceCount} reference(s) in total`)
  log(`Creating new entries...`)

  statusUpdateTimer = setInterval(() => {
    log(` - created ${newReferenceCount}/${referenceCount} - ${Math.round((newReferenceCount / referenceCount) * 100)}%`)
  }, statusUpdateTimeout)

  const newReferences = await createNewEntriesFromReferences(title)
  clearInterval(statusUpdateTimer)

  log(` -- Created ${newReferenceCount} reference(s)`)
  log(`Updating reference-tree...`)

  statusUpdateTimer = setInterval(() => {
    log(` - updated ${updatedReferenceCount}/${referenceCount} - ${Math.round((updatedReferenceCount / referenceCount) * 100)}%`)
  }, statusUpdateTimeout)

  if (!dryRun) {
    await updateReferenceTree(newReferences)
  }

  clearInterval(statusUpdateTimer)

  log(`Updating done.`)

  return newReferences[entryId]
}

export {
  recursiveClone
}