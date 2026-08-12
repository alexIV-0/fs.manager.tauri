// Провайдер хранилища: единая точка, через которую всё остальное говорит с бэкендом.
//
// Enum, а не трейт с async-методами: набор провайдеров закрыт и известен на этапе
// компиляции, диспетч статический, новых зависимостей (`async-trait`, боксы) не надо.
//
// `PlainFolder` (локальная папка без облака) появится здесь же — тогда программа
// с ненастроенным хранилищем работает как раньше, без единого `if` в прикладном коде.

use super::client::StorageApi;
use super::mock::MockApi;
use super::types::*;

#[derive(Debug, Clone)]
pub enum Provider {
    /// Настоящий бэкенд `innovation-hub`.
    Api(StorageApi),
    /// Фикстуры вместо HTTP.
    Mock(MockApi),
}

macro_rules! dispatch {
    ($self:ident, $method:ident ( $($arg:expr),* )) => {
        match $self {
            Provider::Api(a) => a.$method($($arg),*).await,
            Provider::Mock(m) => m.$method($($arg),*).await,
        }
    };
}

impl Provider {
    pub async fn capabilities(&self) -> StorageResult<Capabilities> {
        dispatch!(self, capabilities())
    }

    pub async fn projects(&self) -> StorageResult<ProjectsResponse> {
        dispatch!(self, projects())
    }

    pub async fn tree(&self, project_id: &str, prefix: Option<&str>) -> StorageResult<TreeResponse> {
        dispatch!(self, tree(project_id, prefix))
    }

    pub async fn delta(&self, project_id: &str, since: i64) -> StorageResult<DeltaResponse> {
        dispatch!(self, delta(project_id, since))
    }

    pub async fn presign_get(
        &self,
        project_id: &str,
        s3_key: &str,
        ttl_sec: Option<i64>,
    ) -> StorageResult<PresignResponse> {
        dispatch!(self, presign_get(project_id, s3_key, ttl_sec))
    }

    /// `s3_key` — ключ существующего объекта при перезаливке. См. `StorageApi::presign_put`.
    #[allow(clippy::too_many_arguments)]
    pub async fn presign_put(
        &self,
        project_id: &str,
        folder_path: &str,
        file_name: &str,
        content_type: &str,
        ttl_sec: Option<i64>,
        s3_key: Option<&str>,
    ) -> StorageResult<PresignResponse> {
        dispatch!(
            self,
            presign_put(project_id, folder_path, file_name, content_type, ttl_sec, s3_key)
        )
    }

    /// Подтверждение заливки. Мок его изображает — без этого нельзя проверить
    /// главное свойство заливки: что она не считается успешной без `notify`.
    pub async fn notify(&self, args: super::client::NotifyArgs<'_>) -> StorageResult<ProjectFile> {
        match self {
            Provider::Api(a) => a.notify(args).await,
            Provider::Mock(m) => m.notify(args).await,
        }
    }

    /// Создать логическую папку. В R2 объекта не появляется — это строка в Postgres.
    ///
    /// Мок отказывает намеренно: подделка записи создала бы ложное чувство, что путь
    /// проверен. Демо-режим папки в облаке не создаёт, и это видно сразу.
    pub async fn mkdir(
        &self,
        project_id: &str,
        folder_path: &str,
        name: &str,
        event_id: Option<&str>,
    ) -> StorageResult<ProjectFile> {
        match self {
            Provider::Api(a) => a.mkdir(project_id, folder_path, name, event_id).await,
            Provider::Mock(_) => Err(StorageError::Unsupported(
                "создание папки не поддерживается мок-провайдером".into(),
            )),
        }
    }

    /// Удалить файл или папку (папку — каскадом). Возвращает удалённые ключи R2.
    pub async fn delete(
        &self,
        project_id: &str,
        file_id: &str,
        event_id: Option<&str>,
    ) -> StorageResult<Vec<String>> {
        match self {
            Provider::Api(a) => a.delete(project_id, file_id, event_id).await,
            Provider::Mock(_) => Err(StorageError::Unsupported(
                "удаление не поддерживается мок-провайдером".into(),
            )),
        }
    }

    /// Переименовать проект. У мока нет — подделка создала бы ложное чувство, что
    /// путь проверен.
    pub async fn rename_project(&self, project_id: &str, name: &str) -> StorageResult<()> {
        match self {
            Provider::Api(a) => a.rename_project(project_id, name).await,
            Provider::Mock(_) => Err(StorageError::Unsupported(
                "переименование проекта не поддерживается мок-провайдером".into(),
            )),
        }
    }

    /// Включить/выключить проект. У мока нет: подделка скрыла бы отсутствие эндпоинта.
    pub async fn set_project_paused(&self, project_id: &str, paused: bool) -> StorageResult<()> {
        match self {
            Provider::Api(a) => a.set_project_paused(project_id, paused).await,
            Provider::Mock(_) => Err(StorageError::Unsupported(
                "смена активности проекта не поддерживается мок-провайдером".into(),
            )),
        }
    }

    /// Остальные мутации есть только у настоящего бэкенда: подделка записи создаёт
    /// ложное чувство, что путь проверен.
    pub async fn rename(
        &self,
        project_id: &str,
        file_id: &str,
        new_name: Option<&str>,
        new_folder_path: Option<&str>,
        event_id: Option<&str>,
    ) -> StorageResult<ProjectFile> {
        match self {
            Provider::Api(a) => {
                a.rename(project_id, file_id, new_name, new_folder_path, event_id)
                    .await
            }
            Provider::Mock(_) => Err(StorageError::Unsupported(
                "rename не поддерживается мок-провайдером".into(),
            )),
        }
    }
}
