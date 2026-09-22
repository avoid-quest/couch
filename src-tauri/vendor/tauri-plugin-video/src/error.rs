use serde::{ser::Serializer, Serialize};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(
        "native video protocol mismatch: expected {expected}, received {actual:?} from @get-air/video-tauri version {package_version:?}"
    )]
    ProtocolMismatch {
        expected: u32,
        actual: Option<u32>,
        package_version: Option<String>,
    },
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("GStreamer is unavailable: {0}")]
    RuntimeUnavailable(String),
    #[error("media pipeline failed: {0}")]
    Pipeline(String),
    #[error("native UI operation started; playback must be observed before retrying")]
    DispatcherInFlight,
    #[cfg(mobile)]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ProtocolMismatch { .. } => "PROTOCOL_MISMATCH",
            Self::InvalidRequest(_) => "INVALID_REQUEST",
            Self::RuntimeUnavailable(_) => "RUNTIME_UNAVAILABLE",
            Self::Pipeline(_) => "PIPELINE_FAILED",
            Self::DispatcherInFlight => "DISPATCHER_IN_FLIGHT",
            #[cfg(mobile)]
            Self::PluginInvoke(_) => "MOBILE_PLUGIN_ERROR",
        }
    }

    fn recoverable(&self) -> bool {
        matches!(self, Self::Pipeline(_) | Self::DispatcherInFlight)
    }
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct WireError<'a> {
            code: &'static str,
            message: String,
            recoverable: bool,
            #[serde(skip_serializing_if = "Option::is_none")]
            stage: Option<&'a str>,
        }

        WireError {
            code: self.code(),
            message: self.to_string(),
            recoverable: self.recoverable(),
            stage: match self {
                Self::ProtocolMismatch { .. } => Some("protocol"),
                Self::Pipeline(_) | Self::DispatcherInFlight => Some("pipeline"),
                _ => None,
            },
        }
        .serialize(serializer)
    }
}
