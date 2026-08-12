// Локальный клиент облачного хранилища.
//
// Роли сторон (ideasAndTest/R2_SYNC_PLAN.md, раздел 2):
//   бэкенд `innovation-hub` — каталог, журнал, права, ключи R2, подписи;
//   мы — зеркало на диске, кэш, состояния, передача байтов НАПРЯМУЮ в R2.
//
// Сервер физически не может залить файл, которого у него нет: файл лежит на
// нашем диске. Поэтому бэкенд выдаёт подписанную ссылку, а везём мы.

pub mod client;
pub mod config;
pub mod evict;
pub mod index;
pub mod mock;
pub mod mock_server;
pub mod daemon;
pub mod layout;
pub mod paths;
pub mod pending;
pub mod provider;
pub mod service;
pub mod state;
pub mod sync;
pub mod types;
pub mod upload;
pub mod watcher;

pub use client::{StorageApi, StorageConfig};
pub use evict::{EvictionPolicy, EvictionReport};
pub use index::Index;
pub use mock::MockApi;
pub use paths::{classify, MirrorLocation, MirrorNode};
pub use provider::Provider;
pub use service::{BrowseEntry, LocalFileRow, NotUploadedRow, CopyReport, DeleteStage, DropOwnerReport, PathInfo, ProjectInfo, RenameReport, EnsureResult, StorageService, UploadResult};
pub use state::{FileState, FolderAggregate, FolderBadge};
pub use sync::Sync;
pub use types::*;
