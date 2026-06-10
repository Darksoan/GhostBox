pub(crate) fn text_value(value: Option<&serde_json::Value>) -> String {
    value
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn merge_object_defaults(
    defaults: serde_json::Value,
    overrides: serde_json::Value,
) -> serde_json::Value {
    let mut merged = defaults;
    if let (Some(merged), Some(overrides)) = (merged.as_object_mut(), overrides.as_object()) {
        for (key, value) in overrides {
            merged.insert(key.clone(), value.clone());
        }
    }
    merged
}

pub(crate) fn object_or_empty(value: Option<&serde_json::Value>) -> serde_json::Value {
    value
        .and_then(|value| value.as_object())
        .map(|object| serde_json::Value::Object(object.clone()))
        .unwrap_or_else(|| serde_json::json!({}))
}

pub(crate) fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

pub(crate) fn xml_text(xml: &str, tag_name: &str) -> String {
    let open = format!("<{tag_name}>");
    let close = format!("</{tag_name}>");
    let Some(start) = xml.find(&open).map(|index| index + open.len()) else {
        return String::new();
    };
    let Some(end) = xml[start..].find(&close).map(|index| start + index) else {
        return String::new();
    };

    decode_basic_html_entities(
        xml[start..end]
            .trim()
            .trim_start_matches("<![CDATA[")
            .trim_end_matches("]]>")
            .trim(),
    )
}

pub(crate) fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

pub(crate) trait EmptyStringExt {
    fn if_empty(self, fallback: String) -> String;
}

impl EmptyStringExt for String {
    fn if_empty(self, fallback: String) -> String {
        if self.is_empty() {
            fallback
        } else {
            self
        }
    }
}

pub(crate) trait EmptyVecExt<T> {
    fn if_empty(self, fallback: Vec<T>) -> Vec<T>;
}

impl<T> EmptyVecExt<T> for Vec<T> {
    fn if_empty(self, fallback: Vec<T>) -> Vec<T> {
        if self.is_empty() {
            fallback
        } else {
            self
        }
    }
}
