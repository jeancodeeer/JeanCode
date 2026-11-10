# Ventana de prueba para el driver de control del equipo (solo pruebas; no forma parte de la app).
# Un cuadro de texto, un boton que cuenta clics y una etiqueta con el contador.
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$f = New-Object System.Windows.Forms.Form
$f.Text = 'JeanCode prueba de control'
$f.Size = New-Object System.Drawing.Size(520, 300)
$f.StartPosition = 'CenterScreen'
$f.TopMost = $true
$tb = New-Object System.Windows.Forms.TextBox
$tb.Name = 'Entrada'; $tb.AccessibleName = 'Entrada'
$tb.Location = New-Object System.Drawing.Point(20, 20); $tb.Size = New-Object System.Drawing.Size(460, 30)
$btn = New-Object System.Windows.Forms.Button
$btn.Text = 'Sumar'; $btn.Name = 'Sumar'
$btn.Location = New-Object System.Drawing.Point(20, 70); $btn.Size = New-Object System.Drawing.Size(140, 40)
$lbl = New-Object System.Windows.Forms.Label
$lbl.Text = 'Clics: 0'; $lbl.Name = 'Contador'; $lbl.AccessibleName = 'Contador'
$lbl.Location = New-Object System.Drawing.Point(200, 80); $lbl.Size = New-Object System.Drawing.Size(200, 30)
$pw = New-Object System.Windows.Forms.TextBox
$pw.Name = 'Clave'; $pw.AccessibleName = 'Clave'; $pw.UseSystemPasswordChar = $true
$pw.Location = New-Object System.Drawing.Point(20, 130); $pw.Size = New-Object System.Drawing.Size(200, 30)
$script:n = 0
$btn.Add_Click({ $script:n++; $lbl.Text = "Clics: $script:n" })
$f.Controls.AddRange(@($tb, $btn, $lbl, $pw))
[void]$f.ShowDialog()
