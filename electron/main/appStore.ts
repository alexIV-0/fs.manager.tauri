import Store from 'electron-store';

// Единственный экземпляр хранилища для всего main-процесса
export const appStore = new Store();
