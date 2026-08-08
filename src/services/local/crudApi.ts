import { apiClient } from '../../lib/apiClient';

export function createCrudApi<T>(basePath: string) {
  return {
    list: (query = '') => apiClient.get<T[]>(`${basePath}${query}`),
    get: (id: string) => apiClient.get<T>(`${basePath}/${id}`),
    create: (data: Partial<T>) => apiClient.post<T>(basePath, data),
    update: (id: string, data: Partial<T>) => apiClient.put<T>(`${basePath}/${id}`, data),
    remove: (id: string) => apiClient.delete<T>(`${basePath}/${id}`),
  };
}
