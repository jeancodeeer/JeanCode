// jeancode-hid: pantalla de un iPhone con jailbreak para el mini agente de JeanCode.
// Se compila EN el iPhone (install.sh, con clang y ldid de Procursus) y se firma con jeancode-hid.entitlements.
// Usa APIs privadas de iOS, las mismas que simulatetouch o los grabadores de pantalla:
//   - IOHIDEventSystemClient para inyectar toques, deslizamientos y teclas (como un dedo o un teclado reales)
//   - CARenderServerRenderDisplay para capturar la pantalla en un IOSurface
// Las funciones privadas se cargan con dlsym: compila con el SDK público y, si alguna no existe en tu versión de iOS,
// el comando lo dice en vez de fallar al enlazar.
//
//   jeancode-hid size                         → "ancho alto escala" (puntos y escala)
//   jeancode-hid tap X Y                      → toque en puntos
//   jeancode-hid swipe X1 Y1 X2 Y2 [ms]       → deslizar
//   jeancode-hid text "texto"                 → teclea (ASCII imprimible)
//   jeancode-hid key home|enter|backspace|tab|escape|space|up|down|left|right|lock|volumeup|volumedown
//   jeancode-hid screenshot RUTA.jpg [ancho]  → captura JPEG reducida; imprime "ancho alto anchoReal altoReal"
//
// EXPERIMENTAL: escrito siguiendo esas herramientas conocidas, pero sin probar en un iPhone (no se puede compilar
// para iOS desde Windows). Si algo falla, el ayudante lo informa y el resto del agente sigue funcionando.
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#import <IOSurface/IOSurfaceRef.h>
#include <dlfcn.h>
#include <mach/mach_time.h>
#include <unistd.h>

/* ---------------- privadas, cargadas en tiempo de ejecución ---------------- */
typedef struct __IOHIDEvent *IOHIDEventRef;
typedef struct __IOHIDEventSystemClient *IOHIDEventSystemClientRef;
static IOHIDEventSystemClientRef (*IOHIDEventSystemClientCreate)(CFAllocatorRef);
static void (*IOHIDEventSystemClientDispatchEvent)(IOHIDEventSystemClientRef, IOHIDEventRef);
static IOHIDEventRef (*IOHIDEventCreateDigitizerEvent)(CFAllocatorRef, uint64_t, uint32_t, uint32_t, uint32_t, uint32_t, uint32_t,
    double, double, double, double, double, Boolean, Boolean, uint32_t);
static IOHIDEventRef (*IOHIDEventCreateDigitizerFingerEvent)(CFAllocatorRef, uint64_t, uint32_t, uint32_t, uint32_t,
    double, double, double, double, double, Boolean, Boolean, uint32_t);
static IOHIDEventRef (*IOHIDEventCreateKeyboardEvent)(CFAllocatorRef, uint64_t, uint32_t, uint32_t, Boolean, uint32_t);
static void (*IOHIDEventAppendEvent)(IOHIDEventRef, IOHIDEventRef, uint32_t);
static void (*IOHIDEventSetIntegerValue)(IOHIDEventRef, uint32_t, int);
static void (*IOHIDEventSetSenderID)(IOHIDEventRef, uint64_t);
static void (*CARenderServerRenderDisplay)(kern_return_t, CFStringRef, IOSurfaceRef, int, int);

static int loadPrivate(void) {
  dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", RTLD_NOW);
  dlopen("/System/Library/Frameworks/QuartzCore.framework/QuartzCore", RTLD_NOW);
  struct { void **slot; const char *name; } syms[] = {
    { (void **)&IOHIDEventSystemClientCreate, "IOHIDEventSystemClientCreate" },
    { (void **)&IOHIDEventSystemClientDispatchEvent, "IOHIDEventSystemClientDispatchEvent" },
    { (void **)&IOHIDEventCreateDigitizerEvent, "IOHIDEventCreateDigitizerEvent" },
    { (void **)&IOHIDEventCreateDigitizerFingerEvent, "IOHIDEventCreateDigitizerFingerEvent" },
    { (void **)&IOHIDEventCreateKeyboardEvent, "IOHIDEventCreateKeyboardEvent" },
    { (void **)&IOHIDEventAppendEvent, "IOHIDEventAppendEvent" },
    { (void **)&IOHIDEventSetIntegerValue, "IOHIDEventSetIntegerValue" },
    { (void **)&IOHIDEventSetSenderID, "IOHIDEventSetSenderID" },
    { (void **)&CARenderServerRenderDisplay, "CARenderServerRenderDisplay" },
  };
  for (size_t i = 0; i < sizeof(syms) / sizeof(syms[0]); i++) {
    *syms[i].slot = dlsym(RTLD_DEFAULT, syms[i].name);
    if (!*syms[i].slot) { fprintf(stderr, "falta %s en esta versión de iOS\n", syms[i].name); return 0; }
  }
  return 1;
}

enum { kTransducerHand = 3, kMaskRange = 1, kMaskTouch = 2, kMaskPosition = 4 };
static const uint32_t kFieldDisplayIntegrated = 0xB0019; // kIOHIDEventFieldDigitizerIsDisplayIntegrated
static const uint64_t kSender = 0x000000010000027FULL;   // el que usan las herramientas de inyección conocidas

static IOHIDEventSystemClientRef client(void) {
  static IOHIDEventSystemClientRef c = NULL;
  if (!c) c = IOHIDEventSystemClientCreate(kCFAllocatorDefault);
  return c;
}

static CGSize screenPoints(CGFloat *scale) {
  UIScreen *s = [UIScreen mainScreen];
  if (scale) *scale = s.scale;
  return s.bounds.size;
}

static void dispatch(IOHIDEventRef e) {
  IOHIDEventSetSenderID(e, kSender);
  IOHIDEventSystemClientDispatchEvent(client(), e);
}

/** Un dedo en (x, y) puntos. phase: 0 = baja, 1 = se mueve, 2 = sube. El digitalizador va de 0 a 1. */
static void finger(double x, double y, int phase) {
  CGSize size = screenPoints(NULL);
  double nx = x / size.width, ny = y / size.height;
  Boolean touching = phase != 2;
  uint32_t mask = phase == 1 ? kMaskPosition : (kMaskRange | kMaskTouch);
  uint64_t t = mach_absolute_time();
  IOHIDEventRef hand = IOHIDEventCreateDigitizerEvent(kCFAllocatorDefault, t, kTransducerHand, 0, 0, mask, 0, 0, 0, 0, 0, 0, touching, touching, 0);
  IOHIDEventSetIntegerValue(hand, kFieldDisplayIntegrated, 1);
  IOHIDEventRef f = IOHIDEventCreateDigitizerFingerEvent(kCFAllocatorDefault, t, 1, 2, mask, nx, ny, 0, touching ? 1 : 0, 0, touching, touching, 0);
  IOHIDEventAppendEvent(hand, f, 0);
  dispatch(hand);
  CFRelease(f);
  CFRelease(hand);
}

static void keyEdge(uint32_t page, uint32_t usage, Boolean down) {
  IOHIDEventRef e = IOHIDEventCreateKeyboardEvent(kCFAllocatorDefault, mach_absolute_time(), page, usage, down, 0);
  dispatch(e);
  CFRelease(e);
}
static void key(uint32_t page, uint32_t usage) { keyEdge(page, usage, 1); usleep(40000); keyEdge(page, usage, 0); usleep(40000); }

/** Uso HID (página 7) de un carácter ASCII; *shift = 1 si va con mayúsculas. 0 = no soportado. */
static uint32_t usageOf(char c, int *shift) {
  *shift = 0;
  if (c >= 'a' && c <= 'z') return 0x04 + (c - 'a');
  if (c >= 'A' && c <= 'Z') { *shift = 1; return 0x04 + (c - 'A'); }
  if (c >= '1' && c <= '9') return 0x1E + (c - '1');
  if (c == '0') return 0x27;
  if (c == '\n') return 0x28;
  static const char plain[] = " -=[]\\;'`,./";
  static const uint32_t plainU[] = {0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38};
  static const char shifted[] = "!@#$%^&*()_+{}|:\"~<>?";
  static const uint32_t shiftedU[] = {0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38};
  for (int i = 0; plain[i]; i++) if (plain[i] == c) return plainU[i];
  for (int i = 0; shifted[i]; i++) if (shifted[i] == c) { *shift = 1; return shiftedU[i]; }
  return 0;
}

static int typeText(const char *s) {
  int skipped = 0;
  for (const char *c = s; *c; c++) {
    int shift;
    uint32_t u = usageOf(*c, &shift);
    if (!u) { skipped++; continue; }
    if (shift) keyEdge(7, 0xE1, 1);
    key(7, u);
    if (shift) keyEdge(7, 0xE1, 0);
  }
  if (skipped) fprintf(stderr, "%d caracteres no ASCII sin escribir\n", skipped);
  return 0;
}

static int screenshot(const char *path, int maxWidth) {
  CGFloat scale;
  CGSize pts = screenPoints(&scale);
  size_t w = (size_t)(pts.width * scale), h = (size_t)(pts.height * scale), bpr = w * 4;
  NSDictionary *props = @{ (id)kIOSurfaceWidth: @(w), (id)kIOSurfaceHeight: @(h), (id)kIOSurfaceBytesPerElement: @4,
                           (id)kIOSurfaceBytesPerRow: @(bpr), (id)kIOSurfacePixelFormat: @((uint32_t)'BGRA'), (id)kIOSurfaceAllocSize: @(bpr * h) };
  IOSurfaceRef surface = IOSurfaceCreate((__bridge CFDictionaryRef)props);
  if (!surface) { fprintf(stderr, "no se pudo crear el IOSurface\n"); return 2; }
  IOSurfaceLock(surface, 0, NULL);
  CARenderServerRenderDisplay(0, CFSTR("LCD"), surface, 0, 0);
  CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
  CGContextRef ctx = CGBitmapContextCreate(IOSurfaceGetBaseAddress(surface), w, h, 8, bpr, cs, kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little);
  CGImageRef full = CGBitmapContextCreateImage(ctx);
  IOSurfaceUnlock(surface, 0, NULL);
  size_t ow = maxWidth > 0 && (size_t)maxWidth < w ? (size_t)maxWidth : w, oh = h * ow / w;
  CGContextRef small = CGBitmapContextCreate(NULL, ow, oh, 8, 0, cs, kCGImageAlphaNoneSkipFirst | kCGBitmapByteOrder32Little);
  CGContextSetInterpolationQuality(small, kCGInterpolationHigh);
  CGContextDrawImage(small, CGRectMake(0, 0, ow, oh), full);
  CGImageRef img = CGBitmapContextCreateImage(small);
  NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path]];
  CGImageDestinationRef dst = CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.jpeg"), 1, NULL);
  CGImageDestinationAddImage(dst, img, (__bridge CFDictionaryRef)@{ (id)kCGImageDestinationLossyCompressionQuality: @0.7 });
  bool ok = CGImageDestinationFinalize(dst);
  CFRelease(dst); CGImageRelease(img); CGContextRelease(small); CGImageRelease(full); CGContextRelease(ctx); CGColorSpaceRelease(cs); CFRelease(surface);
  if (!ok) { fprintf(stderr, "no se pudo guardar la captura\n"); return 3; }
  printf("%zu %zu %zu %zu\n", ow, oh, w, h);
  return 0;
}

int main(int argc, char **argv) {
  @autoreleasepool {
    if (argc < 2) { fprintf(stderr, "uso: jeancode-hid size|tap|swipe|text|key|screenshot ...\n"); return 1; }
    if (!loadPrivate()) return 4;
    NSString *cmd = [NSString stringWithUTF8String:argv[1]];
    if ([cmd isEqualToString:@"size"]) { CGFloat s; CGSize p = screenPoints(&s); printf("%.0f %.0f %.0f\n", p.width, p.height, s); return 0; }
    if ([cmd isEqualToString:@"tap"] && argc >= 4) {
      double x = atof(argv[2]), y = atof(argv[3]);
      finger(x, y, 0); usleep(60000); finger(x, y, 2);
      return 0;
    }
    if ([cmd isEqualToString:@"swipe"] && argc >= 6) {
      double x1 = atof(argv[2]), y1 = atof(argv[3]), x2 = atof(argv[4]), y2 = atof(argv[5]);
      int ms = argc >= 7 ? atoi(argv[6]) : 300, steps = MAX(6, ms / 16);
      finger(x1, y1, 0);
      for (int i = 1; i <= steps; i++) { usleep((useconds_t)(ms * 1000 / steps)); finger(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps, 1); }
      finger(x2, y2, 2);
      return 0;
    }
    if ([cmd isEqualToString:@"text"] && argc >= 3) return typeText(argv[2]);
    if ([cmd isEqualToString:@"key"] && argc >= 3) {
      NSString *k = [[NSString stringWithUTF8String:argv[2]] lowercaseString];
      // página 0x0C (consumo): inicio, bloqueo y volumen; página 7 (teclado): el resto
      NSDictionary *consumer = @{ @"home": @0x40, @"lock": @0x30, @"volumeup": @0xE9, @"volumedown": @0xEA };
      NSDictionary *keyboard = @{ @"enter": @0x28, @"return": @0x28, @"escape": @0x29, @"backspace": @0x2A, @"tab": @0x2B, @"space": @0x2C,
                                  @"right": @0x4F, @"left": @0x50, @"down": @0x51, @"up": @0x52 };
      if (consumer[k]) { key(0x0C, [consumer[k] unsignedIntValue]); return 0; }
      if (keyboard[k]) { key(7, [keyboard[k] unsignedIntValue]); return 0; }
      fprintf(stderr, "tecla desconocida: %s\n", argv[2]);
      return 1;
    }
    if ([cmd isEqualToString:@"screenshot"] && argc >= 3) return screenshot(argv[2], argc >= 4 ? atoi(argv[3]) : 0);
    fprintf(stderr, "orden desconocida: %s\n", argv[1]);
    return 1;
  }
}
