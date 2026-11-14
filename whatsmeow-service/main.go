// Whatsmeow sidecar for ThinkIac. Bind it only to localhost; it persists each
// linked device in its own SQLite database under WHATSMEOW_DATA_DIR.
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang/protobuf/proto"
	_ "github.com/mattn/go-sqlite3"
	"github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	waProto "go.mau.fi/whatsmeow/binary/proto"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
)

type session struct {
	client *whatsmeow.Client
	qr     string
	status string
	mu     sync.RWMutex
}

var sessions = map[string]*session{}
var sessionsMu sync.RWMutex
var validName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)

func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func serviceTokenOK(r *http.Request) bool {
	t := os.Getenv("WHATSMEOW_SERVICE_TOKEN")
	return t == "" || r.Header.Get("Authorization") == "Bearer "+t
}
func requireToken(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !serviceTokenOK(r) {
			write(w, 401, map[string]string{"message": "unauthorized"})
			return
		}
		next(w, r)
	}
}

type webhookMessage struct {
	InstanceName string        `json:"instanceName"`
	ID           string        `json:"id"`
	ChatJID      string        `json:"chatJid"`
	SenderJID    string        `json:"senderJid,omitempty"`
	PushName     string        `json:"pushName,omitempty"`
	Text         string        `json:"text,omitempty"`
	FromMe       bool          `json:"fromMe"`
	Timestamp    string        `json:"timestamp"`
	Media        *webhookMedia `json:"media,omitempty"`
}

// WhatsApp may report direct chats using either the privacy-preserving LID or
// the phone-number JID. Keep the Manager on the stable PN form whenever the
// local device store knows the mapping, otherwise the same contact is split
// into multiple conversations and replies can be addressed to the wrong JID.
func canonicalDirectJID(cli *whatsmeow.Client, jid types.JID) types.JID {
	if jid.Server != types.HiddenUserServer || cli.Store.LIDs == nil {
		return jid
	}
	pn, err := cli.Store.LIDs.GetPNForLID(context.Background(), jid)
	if err == nil && !pn.IsEmpty() {
		return pn
	}
	return jid
}

// Media is sent to the local Manager webhook as base64. The sidecar is bound
// to loopback and the Manager persists it immediately in its media store.
// A bounded payload prevents one large attachment from exhausting the runtime.
type webhookMedia struct {
	Type     string `json:"type"`
	Mimetype string `json:"mimetype,omitempty"`
	Filename string `json:"filename,omitempty"`
	Base64   string `json:"base64"`
}

func messageText(msg *waProto.Message) string {
	if msg == nil {
		return ""
	}
	if msg.Conversation != nil {
		return *msg.Conversation
	}
	if msg.ExtendedTextMessage != nil && msg.ExtendedTextMessage.Text != nil {
		return *msg.ExtendedTextMessage.Text
	}
	return ""
}
func mediaLimit() int {
	value, err := strconv.Atoi(os.Getenv("WHATSMEOW_MAX_MEDIA_BYTES"))
	if err != nil || value <= 0 {
		return 64 * 1024 * 1024
	}
	return value
}

func incomingMedia(cli *whatsmeow.Client, message *waProto.Message) *webhookMedia {
	if message == nil {
		return nil
	}
	var typ, mimetype, filename string
	switch {
	case message.ImageMessage != nil:
		typ, mimetype = "image", message.ImageMessage.GetMimetype()
	case message.VideoMessage != nil:
		typ, mimetype = "video", message.VideoMessage.GetMimetype()
	case message.AudioMessage != nil:
		typ, mimetype = "audio", message.AudioMessage.GetMimetype()
	case message.DocumentMessage != nil:
		typ, mimetype, filename = "document", message.DocumentMessage.GetMimetype(), message.DocumentMessage.GetFileName()
	case message.StickerMessage != nil:
		typ, mimetype = "sticker", message.StickerMessage.GetMimetype()
	default:
		return nil
	}
	data, err := cli.DownloadAny(context.Background(), message)
	if err != nil || len(data) == 0 || len(data) > mediaLimit() {
		return nil
	}
	return &webhookMedia{Type: typ, Mimetype: mimetype, Filename: filename, Base64: base64.StdEncoding.EncodeToString(data)}
}

func deliver(name string, cli *whatsmeow.Client, event *events.Message) {
	target := strings.TrimSpace(os.Getenv("WHATSMEOW_WEBHOOK_URL"))
	if target == "" {
		return
	}
	// Sender preserves a LID when WhatsApp supplies one. Chat may still be a
	// phone-number JID, which cannot always be used for a reply on LID-only
	// accounts. The Manager uses senderJid only when it is an @lid address.
	chat := canonicalDirectJID(cli, event.Info.Chat)
	senderJID := canonicalDirectJID(cli, event.Info.Sender)
	sender := senderJID.String()
	// In an outgoing event Sender is this account, not the remote contact.
	// Forwarding that LID makes the Manager move the message to a self-chat.
	if event.Info.IsFromMe || !strings.HasSuffix(sender, "@lid") {
		sender = ""
	}
	body, e := json.Marshal(webhookMessage{InstanceName: name, ID: string(event.Info.ID), ChatJID: chat.String(), SenderJID: sender, PushName: event.Info.PushName, Text: messageText(event.Message), FromMe: event.Info.IsFromMe, Timestamp: event.Info.Timestamp.UTC().Format("2006-01-02T15:04:05.999Z"), Media: incomingMedia(cli, event.Message)})
	if e != nil {
		return
	}
	req, e := http.NewRequest(http.MethodPost, target, bytes.NewReader(body))
	if e != nil {
		return
	}
	req.Header.Set("content-type", "application/json")
	if token := os.Getenv("WHATSMEOW_WEBHOOK_TOKEN"); token != "" {
		req.Header.Set("authorization", "Bearer "+token)
	}
	response, e := (&http.Client{Timeout: 10 * 1000 * 1000 * 1000}).Do(req)
	if e != nil {
		log.Printf("whatsmeow webhook delivery failed for %s/%s: %v", name, event.Info.ID, e)
		return
	}
	if response != nil {
		if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
			log.Printf("whatsmeow webhook delivery rejected for %s/%s: HTTP %d", name, event.Info.ID, response.StatusCode)
		}
		response.Body.Close()
	}
}

func create(name string) (*session, error) {
	if !validName.MatchString(name) {
		return nil, fmt.Errorf("invalid instance name")
	}
	sessionsMu.RLock()
	known := sessions[name]
	sessionsMu.RUnlock()
	if known != nil {
		return known, nil
	}
	dir := os.Getenv("WHATSMEOW_DATA_DIR")
	if dir == "" {
		dir = "./data"
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	store, err := sqlstore.New(context.Background(), "sqlite3", filepath.Join(dir, name+".db")+"?_foreign_keys=on", nil)
	if err != nil {
		return nil, err
	}
	device, err := store.GetFirstDevice(context.Background())
	if err != nil {
		return nil, err
	}
	// GetFirstDevice returns (nil, nil) for a brand-new database. Create and
	// persist a device before inspecting its ID or passing it to whatsmeow.
	// Without this, opening the QR route panics and closes the HTTP connection.
	if device == nil {
		device = store.NewDevice()
	}
	cli := whatsmeow.NewClient(device, nil)
	s := &session{client: cli, status: "connecting"}
	cli.AddEventHandler(func(raw any) {
		s.mu.Lock()
		defer s.mu.Unlock()
		switch raw.(type) {
		case *events.Connected:
			s.status = "open"
			s.qr = ""
		case *events.Disconnected:
			if s.status != "logged_out" {
				s.status = "disconnected"
			}
		case *events.LoggedOut:
			s.status = "logged_out"
			s.qr = ""
		case *events.Message:
			go deliver(name, cli, raw.(*events.Message))
		}
	})
	// A device store may already contain a paired user while the client is
	// temporarily offline after a sidecar restart. In that case it must simply
	// reconnect; GetQRChannel is valid only for an unpaired store.
	if device.ID == nil || device.ID.User == "" {
		qr, err := cli.GetQRChannel(context.Background())
		if err != nil {
			return nil, err
		}
		go func() {
			for item := range qr {
				s.mu.Lock()
				if item.Event == "code" {
					png, e := qrcode.Encode(item.Code, qrcode.Medium, 256)
					if e == nil {
						s.qr = "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
					}
				} else if item.Event == "error" {
					s.status = "error"
				}
				s.mu.Unlock()
			}
		}()
	}
	if err := cli.Connect(); err != nil {
		return nil, err
	}
	sessionsMu.Lock()
	sessions[name] = s
	sessionsMu.Unlock()
	return s, nil
}

func get(name string) (*session, bool) {
	sessionsMu.RLock()
	defer sessionsMu.RUnlock()
	s, ok := sessions[name]
	return s, ok
}

// getOrCreate reopens a persisted device after a sidecar restart. The SQLite
// device store is the source of truth, not the in-memory sessions map.
func getOrCreate(name string) (*session, error) {
	if s, ok := get(name); ok {
		return s, nil
	}
	return create(name)
}

func sendMedia(cli *whatsmeow.Client, jid types.JID, mediaType, encoded, mimetype, filename, caption string) (string, error) {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(data) == 0 {
		return "", fmt.Errorf("mídia base64 inválida")
	}
	if len(data) > mediaLimit() {
		return "", fmt.Errorf("mídia excede o limite de %d bytes", mediaLimit())
	}
	var kind whatsmeow.MediaType
	switch mediaType {
	case "image":
		kind = whatsmeow.MediaImage
	case "video":
		kind = whatsmeow.MediaVideo
	case "audio":
		kind = whatsmeow.MediaAudio
	case "document":
		kind = whatsmeow.MediaDocument
	default:
		return "", fmt.Errorf("tipo de mídia não suportado: %s", mediaType)
	}
	uploaded, err := cli.Upload(context.Background(), data, kind)
	if err != nil {
		return "", fmt.Errorf("falha no upload de mídia: %w", err)
	}
	if mimetype == "" {
		mimetype = "application/octet-stream"
	}
	common := func() (*string, *string, []byte, []byte, []byte, *uint64) {
		return &uploaded.URL, &uploaded.DirectPath, uploaded.MediaKey, uploaded.FileEncSHA256, uploaded.FileSHA256, &uploaded.FileLength
	}
	url, path, key, encHash, hash, length := common()
	var message *waProto.Message
	switch mediaType {
	case "image":
		message = &waProto.Message{ImageMessage: &waProto.ImageMessage{URL: url, DirectPath: path, MediaKey: key, FileEncSHA256: encHash, FileSHA256: hash, FileLength: length, Mimetype: proto.String(mimetype), Caption: proto.String(caption)}}
	case "video":
		message = &waProto.Message{VideoMessage: &waProto.VideoMessage{URL: url, DirectPath: path, MediaKey: key, FileEncSHA256: encHash, FileSHA256: hash, FileLength: length, Mimetype: proto.String(mimetype), Caption: proto.String(caption)}}
	case "audio":
		message = &waProto.Message{AudioMessage: &waProto.AudioMessage{URL: url, DirectPath: path, MediaKey: key, FileEncSHA256: encHash, FileSHA256: hash, FileLength: length, Mimetype: proto.String(mimetype)}}
	case "document":
		message = &waProto.Message{DocumentMessage: &waProto.DocumentMessage{URL: url, DirectPath: path, MediaKey: key, FileEncSHA256: encHash, FileSHA256: hash, FileLength: length, Mimetype: proto.String(mimetype), FileName: proto.String(filename), Caption: proto.String(caption)}}
	}
	result, err := cli.SendMessage(context.Background(), jid, message)
	if err != nil {
		return "", err
	}
	return result.ID, nil
}

// Campaign recipients are stored as E.164 digits, while whatsmeow requires a
// full JID. Keep this normalization at the sidecar boundary too, so direct
// clients cannot accidentally turn a phone number into a JID server name.
func recipientJID(value string) (types.JID, error) {
	value = strings.TrimSpace(value)
	if !strings.Contains(value, "@") {
		digits := strings.Map(func(r rune) rune {
			if r >= '0' && r <= '9' {
				return r
			}
			return -1
		}, value)
		if len(digits) < 8 || len(digits) > 15 {
			return types.JID{}, fmt.Errorf("informe um número de WhatsApp válido, com DDI")
		}
		value = digits + "@s.whatsapp.net"
	}
	return types.ParseJID(value)
}

// humanizedTextSend keeps the typing state at the provider boundary. That
// means a Flow only needs to ask for humanize once, and every `---` part gets
// the same presence behavior. Presence failures are deliberately non-fatal:
// a text message must not be lost merely because WhatsApp did not accept a
// transient presence update.
func humanizedTextSend(cli *whatsmeow.Client, jid types.JID, text string, humanize bool) (string, error) {
	if humanize {
		_ = cli.SendPresence(context.Background(), types.PresenceAvailable)
		_ = cli.SendChatPresence(context.Background(), jid, types.ChatPresenceComposing, types.ChatPresenceMediaText)
		// 36-54 WPM approximates normal mobile typing. Keep the visible wait
		// bounded for long answers so an automation remains responsive.
		wpm := 36 + rand.Float64()*18
		charsPerSecond := (wpm * 5) / 60
		delay := time.Duration(float64(len([]rune(text))) / charsPerSecond * float64(time.Second))
		if delay < 700*time.Millisecond {
			delay = 700 * time.Millisecond
		}
		if delay > 12*time.Second {
			delay = 12 * time.Second
		}
		time.Sleep(delay)
		defer cli.SendChatPresence(context.Background(), jid, types.ChatPresencePaused, types.ChatPresenceMediaText)
	}
	result, err := cli.SendMessage(context.Background(), jid, &waProto.Message{Conversation: proto.String(text)})
	if err != nil {
		return "", err
	}
	return result.ID, nil
}

func groupJID(value string) (types.JID, error) {
	jid, err := types.ParseJID(strings.TrimSpace(value))
	if err != nil || jid.Server != types.GroupServer {
		return types.JID{}, fmt.Errorf("informe um JID de grupo válido (@g.us)")
	}
	return jid, nil
}

type groupParticipantView struct {
	JID          string `json:"jid"`
	PhoneNumber  string `json:"phoneNumber,omitempty"`
	LID          string `json:"lid,omitempty"`
	DisplayName  string `json:"displayName,omitempty"`
	IsAdmin      bool   `json:"isAdmin"`
	IsSuperAdmin bool   `json:"isSuperAdmin"`
	Error        int    `json:"error,omitempty"`
}

type groupView struct {
	JID              string                 `json:"jid"`
	Subject          string                 `json:"subject"`
	Description      string                 `json:"description,omitempty"`
	OwnerJID         string                 `json:"ownerJid,omitempty"`
	CreatedAt        string                 `json:"createdAt,omitempty"`
	IsLocked         bool                   `json:"isLocked"`
	IsAnnounce       bool                   `json:"isAnnounce"`
	ParticipantCount int                    `json:"participantCount"`
	Participants     []groupParticipantView `json:"participants"`
}

func presentGroup(info *types.GroupInfo) groupView {
	participants := make([]groupParticipantView, 0, len(info.Participants))
	for _, participant := range info.Participants {
		participants = append(participants, groupParticipantView{JID: participant.JID.String(), PhoneNumber: participant.PhoneNumber.String(), LID: participant.LID.String(), DisplayName: participant.DisplayName, IsAdmin: participant.IsAdmin, IsSuperAdmin: participant.IsSuperAdmin, Error: participant.Error})
	}
	createdAt := ""
	if !info.GroupCreated.IsZero() {
		createdAt = info.GroupCreated.UTC().Format("2006-01-02T15:04:05.999Z")
	}
	count := info.ParticipantCount
	if count == 0 {
		count = len(info.Participants)
	}
	return groupView{JID: info.JID.String(), Subject: info.Name, Description: info.Topic, OwnerJID: info.OwnerJID.String(), CreatedAt: createdAt, IsLocked: info.IsLocked, IsAnnounce: info.IsAnnounce, ParticipantCount: count, Participants: participants}
}

func presentParticipantChanges(participants []types.GroupParticipant) []groupParticipantView {
	views := make([]groupParticipantView, 0, len(participants))
	for _, participant := range participants {
		views = append(views, groupParticipantView{JID: participant.JID.String(), PhoneNumber: participant.PhoneNumber.String(), LID: participant.LID.String(), DisplayName: participant.DisplayName, IsAdmin: participant.IsAdmin, IsSuperAdmin: participant.IsSuperAdmin, Error: participant.Error})
	}
	return views
}

func disconnect(name string) error {
	s, err := getOrCreate(name)
	if err != nil {
		return err
	}
	// Disconnect somente fecha o transporte e mantém o dispositivo pareado.
	// Para a ação explícita do operador, invalide a sessão no WhatsApp também;
	// caso contrário uma instância apagada localmente volta a conectar após
	// reiniciar o sidecar.
	if err := s.client.Logout(context.Background()); err != nil {
		return err
	}
	s.mu.Lock()
	s.status = "disconnected"
	s.qr = ""
	s.mu.Unlock()
	return nil
}

func remove(name string) error {
	if !validName.MatchString(name) {
		return fmt.Errorf("invalid instance name")
	}
	if s, ok := get(name); ok {
		if err := s.client.Logout(context.Background()); err != nil {
			return err
		}
		sessionsMu.Lock()
		delete(sessions, name)
		sessionsMu.Unlock()
	}
	dir := os.Getenv("WHATSMEOW_DATA_DIR")
	if dir == "" {
		dir = "./data"
	}
	// SQLite pode manter WAL e SHM ao lado do banco. Remover apenas o .db
	// deixava credenciais restauráveis e fazia a instância reaparecer.
	for _, suffix := range []string{".db", ".db-wal", ".db-shm"} {
		target := filepath.Join(dir, name+suffix)
		if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

// restorePersistedSessions reconnects paired devices after a supervised
// restart. Without this, a paired account remains only on disk until somebody
// opens its QR screen or sends a message, leaving inbound messages unobserved.
func restorePersistedSessions() {
	dir := os.Getenv("WHATSMEOW_DATA_DIR")
	if dir == "" {
		dir = "./data"
	}
	files, err := filepath.Glob(filepath.Join(dir, "*.db"))
	if err != nil {
		log.Printf("whatsmeow could not discover persisted sessions: %v", err)
		return
	}
	for _, file := range files {
		name := strings.TrimSuffix(filepath.Base(file), ".db")
		if !validName.MatchString(name) {
			continue
		}
		store, err := sqlstore.New(context.Background(), "sqlite3", file+"?_foreign_keys=on", nil)
		if err != nil {
			log.Printf("whatsmeow could not inspect persisted session %q: %v", name, err)
			continue
		}
		device, err := store.GetFirstDevice(context.Background())
		if err != nil || device == nil || device.ID == nil || device.ID.User == "" {
			continue
		}
		if _, err := create(name); err != nil {
			log.Printf("whatsmeow could not restore paired session %q: %v", name, err)
			continue
		}
		log.Printf("whatsmeow restored paired session %q", name)
	}
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/instances", requireToken(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			write(w, 405, nil)
			return
		}
		var in struct {
			Name string `json:"name"`
		}
		json.NewDecoder(r.Body).Decode(&in)
		s, e := create(in.Name)
		if e != nil {
			write(w, 400, map[string]string{"message": e.Error()})
			return
		}
		s.mu.RLock()
		defer s.mu.RUnlock()
		write(w, 200, map[string]string{"status": s.status, "qrcode": s.qr})
	}))
	mux.HandleFunc("/instances/", requireToken(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/instances/"), "/")
		if len(parts) < 1 || parts[0] == "" {
			write(w, 404, nil)
			return
		}
		name := parts[0]
		if len(parts) == 1 && r.Method == "DELETE" {
			if e := remove(name); e != nil {
				write(w, 500, map[string]string{"message": e.Error()})
				return
			}
			write(w, 200, map[string]bool{"success": true})
			return
		}
		if len(parts) == 2 && parts[1] == "disconnect" && r.Method == "POST" {
			if e := disconnect(name); e != nil {
				write(w, 404, map[string]string{"message": e.Error()})
				return
			}
			write(w, 200, map[string]bool{"success": true})
			return
		}
		s, e := getOrCreate(name)
		if e != nil {
			write(w, 404, map[string]string{"message": e.Error()})
			return
		}
		if len(parts) == 2 && parts[1] == "qr" && r.Method == "GET" {
			s.mu.RLock()
			defer s.mu.RUnlock()
			write(w, 200, map[string]string{"status": s.status, "qrcode": s.qr})
			return
		}
		if len(parts) == 3 && parts[1] == "messages" && parts[2] == "text" && r.Method == "POST" {
			var in struct {
				Recipient string `json:"recipient"`
				Text      string `json:"text"`
				Humanize  bool   `json:"humanize"`
			}
			if e := json.NewDecoder(r.Body).Decode(&in); e != nil || strings.TrimSpace(in.Recipient) == "" || strings.TrimSpace(in.Text) == "" {
				write(w, 400, map[string]string{"message": "recipient e text são obrigatórios"})
				return
			}
			jid, e := recipientJID(in.Recipient)
			if e != nil {
				write(w, 400, map[string]string{"message": e.Error()})
				return
			}
			messageID, e := humanizedTextSend(s.client, jid, in.Text, in.Humanize)
			if e != nil {
				write(w, 502, map[string]string{"message": e.Error()})
				return
			}
			write(w, 200, map[string]string{"providerMessageId": messageID})
			return
		}
		if len(parts) == 3 && parts[1] == "messages" && parts[2] == "media" && r.Method == "POST" {
			var in struct {
				Recipient string `json:"recipient"`
				MediaType string `json:"mediaType"`
				Base64    string `json:"base64"`
				Mimetype  string `json:"mimetype"`
				Filename  string `json:"filename"`
				Caption   string `json:"caption"`
			}
			if e := json.NewDecoder(r.Body).Decode(&in); e != nil || strings.TrimSpace(in.Recipient) == "" || strings.TrimSpace(in.MediaType) == "" || strings.TrimSpace(in.Base64) == "" {
				write(w, 400, map[string]string{"message": "recipient, mediaType e base64 são obrigatórios"})
				return
			}
			jid, e := recipientJID(in.Recipient)
			if e != nil {
				write(w, 400, map[string]string{"message": e.Error()})
				return
			}
			id, e := sendMedia(s.client, jid, in.MediaType, in.Base64, in.Mimetype, in.Filename, in.Caption)
			if e != nil {
				write(w, 502, map[string]string{"message": e.Error()})
				return
			}
			write(w, 200, map[string]string{"providerMessageId": id})
			return
		}
		if len(parts) == 2 && parts[1] == "groups" && r.Method == "GET" {
			infos, e := s.client.GetJoinedGroups(context.Background())
			if e != nil {
				write(w, 502, map[string]string{"message": e.Error()})
				return
			}
			groups := make([]groupView, 0, len(infos))
			for _, info := range infos {
				groups = append(groups, presentGroup(info))
			}
			write(w, 200, map[string]any{"groups": groups})
			return
		}
		if len(parts) == 2 && parts[1] == "groups" && r.Method == "POST" {
			var in struct {
				Subject      string   `json:"subject"`
				Participants []string `json:"participants"`
			}
			if e := json.NewDecoder(r.Body).Decode(&in); e != nil || strings.TrimSpace(in.Subject) == "" || len([]rune(strings.TrimSpace(in.Subject))) > 25 || len(in.Participants) == 0 {
				write(w, 400, map[string]string{"message": "subject (até 25 caracteres) e participants são obrigatórios"})
				return
			}
			participants := make([]types.JID, 0, len(in.Participants))
			for _, raw := range in.Participants {
				jid, err := recipientJID(raw)
				if err != nil {
					write(w, 400, map[string]string{"message": err.Error()})
					return
				}
				participants = append(participants, jid)
			}
			info, e := s.client.CreateGroup(context.Background(), whatsmeow.ReqCreateGroup{Name: strings.TrimSpace(in.Subject), Participants: participants})
			if e != nil {
				write(w, 502, map[string]string{"message": e.Error()})
				return
			}
			write(w, 201, presentGroup(info))
			return
		}
		if len(parts) >= 3 && parts[1] == "groups" {
			jid, err := groupJID(parts[2])
			if err != nil {
				write(w, 400, map[string]string{"message": err.Error()})
				return
			}
			if len(parts) == 3 && r.Method == "GET" {
				info, e := s.client.GetGroupInfo(context.Background(), jid)
				if e != nil {
					write(w, 502, map[string]string{"message": e.Error()})
					return
				}
				write(w, 200, presentGroup(info))
				return
			}
			if len(parts) == 3 && r.Method == "PATCH" {
				var in struct {
					Subject     *string `json:"subject"`
					Description *string `json:"description"`
				}
				if e := json.NewDecoder(r.Body).Decode(&in); e != nil || (in.Subject == nil && in.Description == nil) {
					write(w, 400, map[string]string{"message": "subject e/ou description são obrigatórios"})
					return
				}
				if in.Subject != nil {
					subject := strings.TrimSpace(*in.Subject)
					if subject == "" || len([]rune(subject)) > 25 {
						write(w, 400, map[string]string{"message": "subject deve ter entre 1 e 25 caracteres"})
						return
					}
					if e := s.client.SetGroupName(context.Background(), jid, subject); e != nil {
						write(w, 502, map[string]string{"message": e.Error()})
						return
					}
				}
				if in.Description != nil {
					if e := s.client.SetGroupTopic(context.Background(), jid, "", "", *in.Description); e != nil {
						write(w, 502, map[string]string{"message": e.Error()})
						return
					}
				}
				info, e := s.client.GetGroupInfo(context.Background(), jid)
				if e != nil {
					write(w, 502, map[string]string{"message": e.Error()})
					return
				}
				write(w, 200, presentGroup(info))
				return
			}
			if len(parts) == 4 && parts[3] == "participants" && r.Method == "POST" {
				var in struct {
					Action       string   `json:"action"`
					Participants []string `json:"participants"`
				}
				if e := json.NewDecoder(r.Body).Decode(&in); e != nil || len(in.Participants) == 0 {
					write(w, 400, map[string]string{"message": "action e participants são obrigatórios"})
					return
				}
				action := whatsmeow.ParticipantChange(in.Action)
				if action != whatsmeow.ParticipantChangeAdd && action != whatsmeow.ParticipantChangeRemove && action != whatsmeow.ParticipantChangePromote && action != whatsmeow.ParticipantChangeDemote {
					write(w, 400, map[string]string{"message": "action deve ser add, remove, promote ou demote"})
					return
				}
				participants := make([]types.JID, 0, len(in.Participants))
				for _, raw := range in.Participants {
					participant, e := recipientJID(raw)
					if e != nil {
						write(w, 400, map[string]string{"message": e.Error()})
						return
					}
					participants = append(participants, participant)
				}
				changed, e := s.client.UpdateGroupParticipants(context.Background(), jid, participants, action)
				if e != nil {
					write(w, 502, map[string]string{"message": e.Error()})
					return
				}
				write(w, 200, map[string]any{"participants": presentParticipantChanges(changed)})
				return
			}
			if len(parts) == 4 && parts[3] == "invite" && (r.Method == "GET" || r.Method == "POST") {
				reset := false
				if r.Method == "POST" {
					var in struct {
						Reset bool `json:"reset"`
					}
					if e := json.NewDecoder(r.Body).Decode(&in); e != nil || !in.Reset {
						write(w, 400, map[string]string{"message": "reset=true é obrigatório"})
						return
					}
					reset = true
				}
				link, e := s.client.GetGroupInviteLink(context.Background(), jid, reset)
				if e != nil {
					write(w, 502, map[string]string{"message": e.Error()})
					return
				}
				write(w, 200, map[string]string{"link": link})
				return
			}
			if len(parts) == 4 && parts[3] == "leave" && r.Method == "POST" {
				if e := s.client.LeaveGroup(context.Background(), jid); e != nil {
					write(w, 502, map[string]string{"message": e.Error()})
					return
				}
				write(w, 200, map[string]bool{"success": true})
				return
			}
		}
		write(w, 404, nil)
	}))
	addr := os.Getenv("WHATSMEOW_LISTEN")
	if addr == "" {
		addr = "127.0.0.1:8765"
	}
	restorePersistedSessions()
	http.ListenAndServe(addr, mux)
}
