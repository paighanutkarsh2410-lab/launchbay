{{- define "service.labels" -}}
app.kubernetes.io/name: {{ .Values.name }}
app.kubernetes.io/managed-by: launchbay
launchbay.dev/owner: {{ .Values.owner | quote }}
launchbay.dev/template: {{ .Values.template | quote }}
{{- end }}

{{- define "service.selector" -}}
app.kubernetes.io/name: {{ .Values.name }}
{{- end }}
