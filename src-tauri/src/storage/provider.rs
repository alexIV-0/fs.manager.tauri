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

    pub async fn presign_put(
        &self,
        project_id: &str,
        folder_path: &str,
        file_name: &str,
        content_type: &str,
        ttl_sec: Option<i64>,
    ) -> StorageResult<PresignResponse> {
        dispatch!(
            self,
            presign_put(project_id, folder_path, file_name, content_type, ttl_sec)
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

    /// Остальные мутации есть только у настоящего бэкенда: подделка записи создаёт
    /// ложное чувство, что путь проверен.
    /// Эндпоинт контракта; интерфейсом пока не вызывается.
    #[allow(dead_code)]
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
