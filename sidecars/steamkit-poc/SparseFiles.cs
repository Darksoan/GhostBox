using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace SteamKitPoc;

/// Marca o arquivo de destino como sparse antes da pré-alocação.
///
/// Sem isto, `SetLength` num arquivo de vários GB deixa a Valid Data Length em
/// zero, e toda escrita adiante dela obriga o NTFS a zerar fisicamente o
/// intervalo pulado — trabalho que cresce com o tamanho do arquivo e com o
/// número de escritores concorrentes.
///
/// Medido em 27/08/2026 com Resident Evil 4 (11 arquivos, média 5,6 GB): o
/// estágio de escrita consumiu 1625s acumulados nos primeiros 60s de download,
/// entregando 259 KB/s num NVMe, com a rede ociosa em `perWorker=1,95s`.
/// Quadruplicar os workers (8 para 32) multiplicou o tempo de disco por 4,6 sem
/// mover os bytes — assinatura de escritas serializadas na extensão da VDL.
///
/// Num arquivo sparse os intervalos ainda não escritos não ocupam clusters nem
/// precisam ser zerados. Contrapartida: o espaço deixa de ser reservado na
/// criação, então o disco pode encher no meio do download em vez de falhar já
/// na pré-alocação.
internal static class SparseFiles
{
    private const uint FsctlSetSparse = 0x000900C4;

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeviceIoControl(
        SafeFileHandle device,
        uint controlCode,
        IntPtr inBuffer,
        uint inBufferSize,
        IntPtr outBuffer,
        uint outBufferSize,
        out uint bytesReturned,
        IntPtr overlapped);

    /// Melhor-esforço. Volume que não suporta sparse (FAT32, exFAT) apenas
    /// mantém o comportamento antigo — correto, só mais lento.
    ///
    /// O `stream` precisa ser um handle **síncrono**: num handle aberto com
    /// `FileOptions.Asynchronous`, o `DeviceIoControl` pode voltar com
    /// `ERROR_IO_PENDING` e completar depois do `SetLength`, quando a
    /// pré-alocação densa já teria acontecido.
    public static bool TryMarkSparse(FileStream stream)
    {
        if (!OperatingSystem.IsWindows())
            return false;

        try
        {
            return DeviceIoControl(
                stream.SafeFileHandle,
                FsctlSetSparse,
                IntPtr.Zero,
                0,
                IntPtr.Zero,
                0,
                out _,
                IntPtr.Zero);
        }
        catch
        {
            return false;
        }
    }
}
