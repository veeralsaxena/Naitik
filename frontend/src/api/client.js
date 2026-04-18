import axios from 'axios';

export const apiClient = axios.create({
  baseURL: 'http://localhost:8000',
  timeout: 120000,
});

export async function postVerifyMedia(mediaFile, idDocument, sessionId) {
  const formData = new FormData();
  formData.append('media_file', mediaFile);
  if (idDocument) {
    formData.append('id_document', idDocument);
  }
  if (sessionId) {
    formData.append('session_id', sessionId);
  }

  const response = await apiClient.post('/verify/media', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
}
