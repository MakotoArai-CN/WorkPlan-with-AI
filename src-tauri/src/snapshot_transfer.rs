use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use std::io::{self, Write};

pub const MAX_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_CHUNK_BYTES: usize = 64 * 1024;
const LIFETIME: Duration = Duration::from_secs(60);

struct SnapshotWriter(Vec<u8>);
impl Write for SnapshotWriter {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        if self.0.len().checked_add(data.len()).is_none_or(|size| size > MAX_BYTES) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "Snapshot exceeds 64MB"));
        }
        self.0.extend_from_slice(data);
        Ok(data.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

pub struct Transfer {
    saved_at: u64,
    entries: usize,
    units: usize,
    received: usize,
    bytes: usize,
    next: usize,
    current: Option<(String, usize, usize, String)>,
    keys: Map<String, Value>,
    hash: Sha256,
    touched: Instant,
}

impl Transfer {
    pub fn new(saved_at: u64, entries: usize, units: usize) -> Result<Self, String> {
        if entries > MAX_BYTES || units > MAX_BYTES || entries > units {
            return Err("Invalid snapshot transfer size".into());
        }
        Ok(Self { saved_at, entries, units, received: 0, bytes: 0, next: 0,
            current: None, keys: Map::new(), hash: Sha256::new(), touched: Instant::now() })
    }

    pub fn expired(&self) -> bool { self.touched.elapsed() > LIFETIME }

    pub fn append(&mut self, index: usize, key: String, offset: usize, length: usize, data: String, last: bool) -> Result<(), String> {
        if self.expired() || index != self.next || index >= self.entries
            || data.len() > MAX_CHUNK_BYTES || key.len() > MAX_CHUNK_BYTES || length > self.units
            || !(key.starts_with("workplan_") || key.starts_with("planpro_")) {
            return Err("Invalid or expired snapshot chunk".into());
        }
        let count = data.encode_utf16().count();
        if self.current.is_none() {
            if offset != 0 || self.keys.contains_key(&key) { return Err("Duplicate or out-of-order snapshot key".into()); }
            let key_units = key.encode_utf16().count();
            self.received = self.received.checked_add(key_units).ok_or("Snapshot too large")?;
            self.bytes = self.bytes.checked_add(key.len()).ok_or("Snapshot too large")?;
            if self.received > self.units || self.bytes > MAX_BYTES { return Err("Snapshot too large".into()); }
            self.hash.update((key.len() as u64).to_le_bytes());
            self.hash.update(key.as_bytes());
            self.hash.update((length as u64).to_le_bytes());
            self.current = Some((key.clone(), length, 0, String::new()));
        }
        let (current_key, expected, position, value) = self.current.as_mut().ok_or("Missing snapshot key")?;
        if *current_key != key || *expected != length || *position != offset
            || count == 0 && !(last && length == 0 && offset == 0)
            || offset.checked_add(count).is_none_or(|end| end > length || last != (end == length)) {
            return Err("Invalid snapshot chunk ordering or length".into());
        }
        self.received = self.received.checked_add(count).ok_or("Snapshot too large")?;
        self.bytes = self.bytes.checked_add(data.len()).ok_or("Snapshot too large")?;
        if self.received > self.units || self.bytes > MAX_BYTES { return Err("Snapshot too large".into()); }
        self.hash.update(data.as_bytes());
        value.push_str(&data);
        *position += count;
        self.touched = Instant::now();
        if last {
            let (key, _, _, value) = self.current.take().ok_or("Missing snapshot key")?;
            self.keys.insert(key, Value::String(value));
            self.next += 1;
        }
        Ok(())
    }

    pub fn finish(self, digest: &str) -> Result<String, String> {
        if self.expired() || self.current.is_some() || self.next != self.entries
            || self.received != self.units || digest.len() != 64
            || !digest.bytes().all(|c| c.is_ascii_hexdigit())
            || format!("{:x}", self.hash.finalize()) != digest {
            return Err("Incomplete or corrupted snapshot transfer".into());
        }
        let mut writer = SnapshotWriter(Vec::new());
        serde_json::to_writer(&mut writer, &serde_json::json!({
            "format":"workplan-local-db", "version":1, "savedAt":self.saved_at, "keys":self.keys
        })).map_err(|e| e.to_string())?;
        String::from_utf8(writer.0).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn digest(key: &str, value: &str) -> String {
        let mut hash = Sha256::new();
        hash.update((key.len() as u64).to_le_bytes()); hash.update(key.as_bytes());
        hash.update((value.encode_utf16().count() as u64).to_le_bytes()); hash.update(value.as_bytes());
        format!("{:x}", hash.finalize())
    }
    #[test]
    fn complete_unicode_and_empty_values_match_the_existing_snapshot_format() {
        for value in ["", "first\nquote\"\\\u{7b14}\u{8bb0}\u{1f600}end"] {
            let mut transfer = Transfer::new(123, 1, "workplan_notes".len() + value.encode_utf16().count()).unwrap();
            let length = value.encode_utf16().count();
            transfer.append(0, "workplan_notes".into(), 0, length, value.into(), true).unwrap();
            let result: Value = serde_json::from_str(&transfer.finish(&digest("workplan_notes", value)).unwrap()).unwrap();
            assert_eq!(result["keys"]["workplan_notes"], value); assert_eq!(result["savedAt"], 123);
        }
    }
    #[test]
    fn missing_corrupt_duplicate_and_out_of_order_parts_are_rejected() {
        let create = || Transfer::new(123, 1, 18).unwrap();
        let mut transfer = create();
        assert!(transfer.append(1, "workplan_notes".into(), 0, 4, "test".into(), true).is_err());
        let mut transfer = create();
        transfer.append(0, "workplan_notes".into(), 0, 4, "te".into(), false).unwrap();
        assert!(transfer.append(0, "workplan_notes".into(), 0, 4, "te".into(), false).is_err());
        assert!(transfer.finish(&digest("workplan_notes", "test")).is_err());
        let mut transfer = create();
        transfer.append(0, "workplan_notes".into(), 0, 4, "test".into(), true).unwrap();
        assert!(transfer.finish(&"0".repeat(64)).is_err());
        let mut transfer = Transfer::new(123, 2, 36).unwrap();
        transfer.append(0, "workplan_notes".into(), 0, 4, "test".into(), true).unwrap();
        assert!(transfer.append(1, "workplan_notes".into(), 0, 4, "test".into(), true).is_err());
    }
    #[test]
    fn oversized_and_expired_transfers_never_produce_a_snapshot() {
        assert!(Transfer::new(0, 1, MAX_BYTES + 1).is_err());
        let mut transfer = Transfer::new(0, 1, MAX_BYTES).unwrap();
        assert!(transfer.append(0, "workplan_notes".into(), 0, MAX_CHUNK_BYTES + 1, "x".repeat(MAX_CHUNK_BYTES + 1), true).is_err());
        let mut transfer = Transfer::new(0, 1, 18).unwrap();
        transfer.touched = Instant::now() - LIFETIME - Duration::from_secs(1);
        assert!(transfer.append(0, "workplan_notes".into(), 0, 4, "test".into(), true).is_err());
        let mut writer = SnapshotWriter(vec![0; MAX_BYTES - 1]);
        assert!(writer.write_all(b"xx").is_err());
        assert_eq!(writer.0.len(), MAX_BYTES - 1);
    }
}
