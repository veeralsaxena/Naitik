export const BALLERINE_FLOW_ID = 'kyc-flow';

export const BALLERINE_CONFIG = {
  flows: {
    [BALLERINE_FLOW_ID]: {
      steps: [
        { name: 'welcome', id: 'welcome' },
        {
          name: 'document-selection',
          id: 'doc-select',
          documentOptions: ['passport', 'id_card', 'drivers_license'],
        },
        { name: 'document-photo', id: 'doc-photo' },
        { name: 'selfie', id: 'selfie' },
        { name: 'loading', id: 'processing' },
      ],
    },
  },
};

export async function loadBallerineFlows() {
  const loadedModule = await import(/* @vite-ignore */ '@ballerine/web-ui-sdk');
  const flows = loadedModule?.flows ?? loadedModule?.default?.flows;
  if (!flows) {
    throw new Error('Ballerine SDK loaded without a flows export.');
  }
  return flows;
}

export async function normaliseBallerineAsset(asset, fallbackName) {
  if (!asset) {
    return null;
  }

  if (asset instanceof File) {
    return asset;
  }

  if (asset instanceof Blob) {
    return new File([asset], fallbackName, { type: asset.type || 'application/octet-stream' });
  }

  if (typeof asset === 'string' && asset.startsWith('data:')) {
    const response = await fetch(asset);
    const blob = await response.blob();
    return new File([blob], fallbackName, { type: blob.type || 'application/octet-stream' });
  }

  if (asset?.file instanceof File) {
    return asset.file;
  }

  if (asset?.blob instanceof Blob) {
    return new File([asset.blob], asset?.name || fallbackName, {
      type: asset.blob.type || 'application/octet-stream',
    });
  }

  return null;
}

export async function extractBallerineSubmission(payload) {
  const selfieCandidate =
    payload?.selfie ??
    payload?.selfiePhoto ??
    payload?.selfieFile ??
    payload?.documents?.selfie ??
    payload?.artifacts?.selfie ??
    null;

  const documentCandidate =
    payload?.document ??
    payload?.documentPhoto ??
    payload?.documentFile ??
    payload?.documents?.document ??
    payload?.documents?.front ??
    payload?.artifacts?.document ??
    null;

  return {
    mediaFile: await normaliseBallerineAsset(selfieCandidate, 'ballerine-selfie.jpg'),
    idDocument: await normaliseBallerineAsset(documentCandidate, 'ballerine-document.jpg'),
  };
}
