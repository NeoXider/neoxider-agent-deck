using Microsoft.Win32.SafeHandles;
using System.ComponentModel;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace NeoXiderAgentDeck.BridgeHost;

internal sealed class SafeSidHandle : SafeHandleZeroOrMinusOneIsInvalid
{
    private SafeSidHandle()
        : base(true)
    {
    }

    protected override bool ReleaseHandle() => NativeMethods.FreeSid(handle) == IntPtr.Zero;
}

internal static class NativePipeSecurity
{
    internal static SafeSidHandle DeriveAppContainerSid(string packageFamilyName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(packageFamilyName);

        int result = NativeMethods.DeriveAppContainerSidFromAppContainerName(
            packageFamilyName,
            out SafeSidHandle sid);
        if (result < 0 || sid is null || sid.IsInvalid)
        {
            sid?.Dispose();
            if (result < 0)
            {
                Marshal.ThrowExceptionForHR(result);
            }

            throw new BridgeStartupException("Windows returned an invalid AppContainer SID.");
        }

        return sid;
    }

    internal static string GetSidString(SafeSidHandle sid)
    {
        ArgumentNullException.ThrowIfNull(sid);
        if (sid.IsInvalid)
        {
            throw new ArgumentException("The SID handle is invalid.", nameof(sid));
        }

        if (!NativeMethods.ConvertSidToStringSidW(sid, out IntPtr textPointer))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        try
        {
            return Marshal.PtrToStringUni(textPointer)
                ?? throw new BridgeStartupException("Windows returned an empty AppContainer SID.");
        }
        finally
        {
            _ = NativeMethods.LocalFree(textPointer);
        }
    }

    internal static NamedPipeServerStream CreateServer(SafeSidHandle expectedSid, string expectedSidText)
    {
        string currentUserSid = WindowsIdentity.GetCurrent().User?.Value
            ?? throw new BridgeStartupException("The current Windows user SID could not be resolved.");
        string sddl = SecurityDescriptorBuilder.BuildPipeSddl(expectedSidText, currentUserSid);
        if (!NativeMethods.ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl,
                NativeMethods.SddlRevision1,
                out IntPtr securityDescriptor,
                out _))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        try
        {
            var attributes = new NativeMethods.SecurityAttributes
            {
                Length = Marshal.SizeOf<NativeMethods.SecurityAttributes>(),
                SecurityDescriptor = securityDescriptor,
                InheritHandle = false,
            };

            SafePipeHandle pipeHandle = NativeMethods.CreateNamedPipeW(
                BridgeConstants.FullPipeName,
                NativeMethods.PipeAccessDuplex |
                    NativeMethods.FileFlagOverlapped |
                    NativeMethods.FileFlagFirstPipeInstance,
                NativeMethods.PipeTypeByte |
                    NativeMethods.PipeReadModeByte |
                    NativeMethods.PipeWait |
                    NativeMethods.PipeRejectRemoteClients,
                1,
                BridgeConstants.MaximumFrameBytes,
                BridgeConstants.MaximumFrameBytes,
                0,
                ref attributes);

            if (pipeHandle.IsInvalid)
            {
                int error = Marshal.GetLastWin32Error();
                pipeHandle.Dispose();
                throw new Win32Exception(error);
            }

            try
            {
                return new NamedPipeServerStream(
                    PipeDirection.InOut,
                    isAsync: true,
                    isConnected: false,
                    pipeHandle);
            }
            catch
            {
                pipeHandle.Dispose();
                throw;
            }
        }
        finally
        {
            _ = NativeMethods.LocalFree(securityDescriptor);
            GC.KeepAlive(expectedSid);
        }
    }

    internal static bool AuthenticateConnectedClient(
        NamedPipeServerStream pipe,
        SafeSidHandle expectedAppContainerSid,
        out string failure)
    {
        ArgumentNullException.ThrowIfNull(pipe);
        ArgumentNullException.ThrowIfNull(expectedAppContainerSid);

        if (!NativeMethods.ImpersonateNamedPipeClient(pipe.SafePipeHandle))
        {
            failure = $"ImpersonateNamedPipeClient failed ({Marshal.GetLastWin32Error()}).";
            return false;
        }

        try
        {
            if (!NativeMethods.OpenThreadToken(
                    NativeMethods.GetCurrentThread(),
                    NativeMethods.TokenQuery,
                    openAsSelf: true,
                    out SafeAccessTokenHandle token))
            {
                failure = $"OpenThreadToken failed ({Marshal.GetLastWin32Error()}).";
                return false;
            }

            using (token)
            {
                if (!GetTokenInt32(token, NativeMethods.TokenIsAppContainer, out int isAppContainer) ||
                    isAppContainer == 0)
                {
                    failure = "The pipe client token is not an AppContainer token.";
                    return false;
                }

                if (!TokenMatchesAppContainerSid(token, expectedAppContainerSid, out bool hasSid))
                {
                    failure = hasSid
                        ? "The pipe client AppContainer SID did not match the installed widget package."
                        : "The pipe client token did not contain an AppContainer SID.";
                    return false;
                }

                failure = string.Empty;
                return true;
            }
        }
        finally
        {
            if (!NativeMethods.RevertToSelf())
            {
                Environment.FailFast("RevertToSelf failed after named-pipe client authentication.");
            }
        }
    }

    private static bool GetTokenInt32(
        SafeAccessTokenHandle token,
        int informationClass,
        out int value)
    {
        IntPtr buffer = Marshal.AllocHGlobal(sizeof(int));
        try
        {
            if (!NativeMethods.GetTokenInformation(
                    token,
                    informationClass,
                    buffer,
                    sizeof(int),
                    out _))
            {
                value = 0;
                return false;
            }

            value = Marshal.ReadInt32(buffer);
            return true;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static bool TokenMatchesAppContainerSid(
        SafeAccessTokenHandle token,
        SafeSidHandle expectedSid,
        out bool hasSid)
    {
        _ = NativeMethods.GetTokenInformation(
            token,
            NativeMethods.TokenAppContainerSid,
            IntPtr.Zero,
            0,
            out int requiredLength);
        if (requiredLength < IntPtr.Size)
        {
            hasSid = false;
            return false;
        }

        IntPtr buffer = Marshal.AllocHGlobal(requiredLength);
        try
        {
            if (!NativeMethods.GetTokenInformation(
                    token,
                    NativeMethods.TokenAppContainerSid,
                    buffer,
                    requiredLength,
                    out _))
            {
                hasSid = false;
                return false;
            }

            IntPtr clientSid = Marshal.ReadIntPtr(buffer);
            hasSid = clientSid != IntPtr.Zero && NativeMethods.IsValidSid(clientSid);
            return hasSid && NativeMethods.EqualSid(clientSid, expectedSid);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }
}

internal static class NativeMethods
{
    internal const uint PipeAccessDuplex = 0x00000003;
    internal const uint FileFlagOverlapped = 0x40000000;
    internal const uint FileFlagFirstPipeInstance = 0x00080000;
    internal const uint PipeTypeByte = 0x00000000;
    internal const uint PipeReadModeByte = 0x00000000;
    internal const uint PipeWait = 0x00000000;
    internal const uint PipeRejectRemoteClients = 0x00000008;
    internal const uint TokenQuery = 0x0008;
    internal const int TokenIsAppContainer = 29;
    internal const int TokenAppContainerSid = 31;
    internal const uint SddlRevision1 = 1;

    [StructLayout(LayoutKind.Sequential)]
    internal struct SecurityAttributes
    {
        internal int Length;
        internal IntPtr SecurityDescriptor;

        [MarshalAs(UnmanagedType.Bool)]
        internal bool InheritHandle;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateNamedPipeW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    internal static extern SafePipeHandle CreateNamedPipeW(
        string name,
        uint openMode,
        uint pipeMode,
        uint maximumInstances,
        uint outputBufferSize,
        uint inputBufferSize,
        uint defaultTimeout,
        ref SecurityAttributes securityAttributes);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ImpersonateNamedPipeClient(SafePipeHandle namedPipe);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool RevertToSelf();

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool OpenThreadToken(
        IntPtr threadHandle,
        uint desiredAccess,
        [MarshalAs(UnmanagedType.Bool)] bool openAsSelf,
        out SafeAccessTokenHandle tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetTokenInformation(
        SafeAccessTokenHandle tokenHandle,
        int tokenInformationClass,
        IntPtr tokenInformation,
        int tokenInformationLength,
        out int returnLength);

    [DllImport("advapi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool EqualSid(IntPtr firstSid, SafeSidHandle secondSid);

    [DllImport("advapi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool IsValidSid(IntPtr sid);

    [DllImport("advapi32.dll")]
    internal static extern IntPtr FreeSid(IntPtr sid);

    [DllImport("advapi32.dll", EntryPoint = "ConvertStringSecurityDescriptorToSecurityDescriptorW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(
        string stringSecurityDescriptor,
        uint stringSecurityDescriptorRevision,
        out IntPtr securityDescriptor,
        out uint securityDescriptorSize);

    [DllImport("advapi32.dll", EntryPoint = "ConvertSidToStringSidW", SetLastError = true, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool ConvertSidToStringSidW(
        SafeSidHandle sid,
        out IntPtr stringSid);

    [DllImport("userenv.dll", EntryPoint = "DeriveAppContainerSidFromAppContainerName", CharSet = CharSet.Unicode, ExactSpelling = true)]
    internal static extern int DeriveAppContainerSidFromAppContainerName(
        string appContainerName,
        out SafeSidHandle appContainerSid);

    [DllImport("kernel32.dll")]
    internal static extern IntPtr GetCurrentThread();

    [DllImport("kernel32.dll")]
    internal static extern IntPtr LocalFree(IntPtr memory);
}
